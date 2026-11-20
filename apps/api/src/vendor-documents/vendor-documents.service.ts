import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Role, VendorStatus, type VerificationStatus } from "@prisma/client";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import type { RequestUser } from "../common/request-user";
import type { DocumentMetadataDto } from "../vendors/vendors.dto";
import { VendorsService } from "../vendors/vendors.service";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service";
import { hasExpectedFileSignature } from "../storage/file-signature";

const ALLOWED_MIME = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

@Injectable()
export class VendorDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: VendorsService,
    private readonly config: ConfigService,
    private readonly storage: PrivateObjectStorageService,
  ) {}

  async upload(
    userId: string,
    metadata: DocumentMetadataDto,
    file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("Document file is required");
    const expectedExtension = ALLOWED_MIME.get(file.mimetype);
    if (
      !expectedExtension ||
      extname(file.originalname).toLowerCase() !== expectedExtension
    )
      throw new BadRequestException(
        "Only matching PDF, JPG, PNG or WEBP files are accepted",
      );
    if (!hasExpectedFileSignature(file.buffer, file.mimetype))
      throw new BadRequestException(
        "Document content does not match its declared file type",
      );
    const maxBytes = this.config.get<number>("MAX_UPLOAD_BYTES", 5_242_880);
    if (file.size > maxBytes)
      throw new BadRequestException(`File exceeds ${maxBytes} bytes`);
    const vendor = await this.vendors.getByUser(userId);
    if (
      vendor.status === VendorStatus.APPROVED ||
      vendor.status === VendorStatus.SUSPENDED
    ) {
      throw new ForbiddenException(
        "Approved or suspended vendor documents require administrator review",
      );
    }
    const vendorId = vendor.id;
    const storageKey = `${vendorId}/${randomUUID()}${expectedExtension}`;
    const existing = await this.prisma.vendorDocument.findUnique({
      where: { vendorId_type: { vendorId, type: metadata.type } },
      select: { storageKey: true },
    });
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    let saved;
    try {
      saved = await this.prisma.vendorDocument.upsert({
        where: { vendorId_type: { vendorId, type: metadata.type } },
        create: {
          vendorId,
          type: metadata.type,
          originalName: file.originalname,
          storageKey,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          documentNumber: metadata.documentNumber,
          expiresAt: metadata.expiresAt
            ? new Date(metadata.expiresAt)
            : undefined,
        },
        update: {
          originalName: file.originalname,
          storageKey,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          documentNumber: metadata.documentNumber,
          expiresAt: metadata.expiresAt
            ? new Date(metadata.expiresAt)
            : undefined,
          status: "PENDING",
          rejectionReason: null,
          verifiedAt: null,
          verifiedById: null,
        },
        select: {
          id: true,
          type: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
    // If another valid upload replaces this document immediately after this
    // write, remove our now-unreferenced object instead of the new record.
    // A read failure must never delete an object that was already committed.
    const current = await this.prisma.vendorDocument.findUnique({
      where: { id: saved.id },
      select: { storageKey: true },
    }).catch(() => undefined);
    if (current?.storageKey === storageKey) {
      if (existing?.storageKey && existing.storageKey !== storageKey) {
        await this.storage.remove(existing.storageKey).catch(() => undefined);
      }
    } else if (current) {
      await this.storage.remove(storageKey).catch(() => undefined);
    }
    return saved;
  }

  async verify(
    documentId: string,
    actorId: string,
    status: VerificationStatus,
    rejectionReason?: string,
  ) {
    if (status === "PENDING")
      throw new BadRequestException(
        "Administrator verification must resolve to VERIFIED or REJECTED",
      );
    if (status === "REJECTED" && !rejectionReason)
      throw new BadRequestException("Rejection reason is required");
    const document = await this.prisma.vendorDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException("Vendor document not found");
    const updated = await this.prisma.vendorDocument.update({
      where: { id: documentId },
      data: {
        status,
        rejectionReason: status === "REJECTED" ? rejectionReason : null,
        verifiedById: actorId,
        verifiedAt: new Date(),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `VENDOR_DOCUMENT_${status}`,
        entityType: "VendorDocument",
        entityId: documentId,
        previousValue: { status: document.status },
        newValue: { status, rejectionReason },
      },
    });
    return updated;
  }

  async download(
    user: RequestUser,
    documentId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; name: string }> {
    const document = await this.prisma.vendorDocument.findUnique({
      where: { id: documentId },
      include: { vendor: { select: { userId: true } } },
    });
    if (!document) throw new NotFoundException("Vendor document not found");
    if (user.role !== Role.ADMIN && document.vendor.userId !== user.id)
      throw new ForbiddenException("You cannot access another vendor document");
    return {
      bytes: await this.storage.get(document.storageKey),
      mimeType: document.mimeType,
      name: document.originalName,
    };
  }
}
