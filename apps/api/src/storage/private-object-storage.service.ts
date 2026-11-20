import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
  ServerSideEncryption,
} from "@aws-sdk/client-s3";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

type StorageProvider = "local" | "s3";

@Injectable()
export class PrivateObjectStorageService {
  private readonly provider: StorageProvider;
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly serverSideEncryption?: ServerSideEncryption;
  private readonly kmsKeyId?: string;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.getOrThrow<StorageProvider>(
      "DOCUMENT_STORAGE_PROVIDER",
    );
    if (this.provider === "s3") {
      const accessKeyId = this.config.get<string>(
        "DOCUMENT_STORAGE_S3_ACCESS_KEY_ID",
      );
      const secretAccessKey = this.config.get<string>(
        "DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY",
      );
      this.bucket = this.config.getOrThrow<string>(
        "DOCUMENT_STORAGE_S3_BUCKET",
      );
      this.serverSideEncryption = this.config.getOrThrow<ServerSideEncryption>(
        "DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION",
      );
      this.kmsKeyId = this.config.get<string>(
        "DOCUMENT_STORAGE_S3_KMS_KEY_ID",
      );
      this.s3 = new S3Client({
        region: this.config.getOrThrow<string>("DOCUMENT_STORAGE_S3_REGION"),
        endpoint: this.config.get<string>("DOCUMENT_STORAGE_S3_ENDPOINT"),
        forcePathStyle:
          this.config.get<string>("DOCUMENT_STORAGE_S3_FORCE_PATH_STYLE") ===
          "true",
        credentials:
          accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
      });
    }
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.assertSafeKey(key);
    if (this.provider === "local") {
      const absolute = this.resolveLocalPath(key);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes, { flag: "wx" });
      return;
    }
    await this.s3?.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption: this.serverSideEncryption,
        SSEKMSKeyId: this.kmsKeyId,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    this.assertSafeKey(key);
    if (this.provider === "local") return readFile(this.resolveLocalPath(key));
    const object = await this.s3?.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!object?.Body)
      throw new InternalServerErrorException("Stored document is unavailable");
    return Buffer.from(await object.Body.transformToByteArray());
  }

  /** Removes a private object after a failed write or a safe replacement. */
  async remove(key: string): Promise<void> {
    this.assertSafeKey(key);
    if (this.provider === "local") {
      await rm(this.resolveLocalPath(key), { force: true });
      return;
    }
    await this.s3?.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async readiness(): Promise<void> {
    if (this.provider === "local") {
      await mkdir(this.resolveLocalPath("health"), { recursive: true });
      return;
    }
    if (!this.s3 || !this.bucket) {
      throw new InternalServerErrorException("Document storage is unavailable");
    }
    await this.s3.send(
      new HeadBucketCommand({ Bucket: this.bucket }),
      { abortSignal: AbortSignal.timeout(5_000) },
    );
  }

  private resolveLocalPath(key: string): string {
    const root = resolve(
      this.config.getOrThrow<string>("PRIVATE_UPLOAD_DIR"),
    );
    const absolute = resolve(root, key);
    if (!absolute.startsWith(`${root}${sep}`))
      throw new BadRequestException("Invalid private storage path");
    return absolute;
  }

  private assertSafeKey(key: string): void {
    if (
      !key ||
      key.includes("\\") ||
      key.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new BadRequestException("Invalid private storage key");
    }
  }
}
