import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrderStatus, ReviewStatus } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type { CreateReviewDto, UpdateReviewDto } from "./reviews.dto";
import { ComplaintCategory } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import sharp from "sharp";
import { PrivateObjectStorageService } from "../storage/private-object-storage.service";

const REVIEW_IMAGE_TYPES = new Map([['image/jpeg', new Set(['.jpg', '.jpeg'])], ['image/png', new Set(['.png'])], ['image/webp', new Set(['.webp'])]]);
const REVIEW_IMAGE_KEY_PREFIX = "review-images";
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: PrivateObjectStorageService,
  ) {}
  async create(userId: string, productId: string, input: CreateReviewDto, files: Express.Multer.File[] = []) {
    const item = await this.prisma.orderItem.findFirst({
      where: {
        id: input.orderItemId,
        productId,
        vendorOrder: { masterOrder: { customer: { userId } } },
      },
      include: {
        vendorOrder: {
          include: { masterOrder: { include: { customer: true } } },
        },
      },
    });
    if (!item) throw new NotFoundException("Purchased order item not found");
    if (item.status !== OrderStatus.DELIVERED)
      throw new BadRequestException("Only delivered products can be reviewed");
    const uploaded = await this.storeImages(files);
    const images = [...(input.imageUrls ?? []), ...uploaded].slice(0, 3);
    let review;
    try {
      review = await this.prisma.review.create({
        data: {
          customerId: item.vendorOrder.masterOrder.customer.id,
          productId,
          orderItemId: item.id,
          rating: input.rating,
          comment: input.comment,
          images,
          status: ReviewStatus.PENDING,
        },
      });
    } catch (error) {
      await this.removeStoredImages(uploaded);
      throw error;
    }
    await this.removeStoredImages(uploaded.filter((url) => !images.includes(url)));
    return this.present(review);
  }
  async public(productId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { productId, status: ReviewStatus.PUBLISHED },
      select: {
        id: true,
        rating: true,
        comment: true,
        images: true,
        createdAt: true,
        customer: { select: { firstName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      images: Array.isArray(review.images) ? review.images.filter((image): image is string => typeof image === "string") : [],
      customerName: review.customer.firstName,
      submittedAt: review.createdAt.toISOString(),
    }));
  }

  async update(userId: string, id: string, input: UpdateReviewDto, files: Express.Multer.File[] = []) {
    const review = await this.prisma.review.findFirst({ where: { id, customer: { userId } } });
    if (!review) throw new NotFoundException("Review not found");
    const uploaded = await this.storeImages(files);
    const images = uploaded.length
      ? [...(input.imageUrls ?? []), ...uploaded].slice(0, 3)
      : (input.imageUrls ?? (Array.isArray(review.images) ? review.images : []));
    let updated;
    try {
      updated = await this.prisma.review.update({
        where: { id },
        data: { rating: input.rating, comment: input.comment, images, status: ReviewStatus.PENDING },
      });
    } catch (error) {
      await this.removeStoredImages(uploaded);
      throw error;
    }
    await this.removeStoredImages(uploaded.filter((url) => !images.includes(url)));
    return this.present(updated);
  }

  async report(userId: string, id: string, reason?: string) {
    const [review, reporter] = await Promise.all([
      this.prisma.review.findUnique({ where: { id }, include: { product: { select: { name: true, vendorId: true } } } }),
      this.prisma.customerProfile.findUnique({ where: { userId } }),
    ]);
    if (!review || review.status !== ReviewStatus.PUBLISHED) throw new NotFoundException("Published review not found");
    if (!reporter) throw new NotFoundException("Customer not found");
    if (review.customerId === reporter.id) throw new ForbiddenException("You cannot report your own review");
    const existing = await this.prisma.complaint.findFirst({
      where: { customerId: reporter.id, subject: `Reported review ${review.id}`, status: { not: "CLOSED" } },
    });
    if (existing) return { reported: true, referenceNumber: existing.referenceNumber };
    const complaint = await this.prisma.complaint.create({
      data: {
        referenceNumber: `CMP-${Date.now()}-REVIEW`,
        customerId: reporter.id,
        vendorId: review.product.vendorId,
        category: ComplaintCategory.PRODUCT,
        subject: `Reported review ${review.id}`,
        description: reason?.trim() || `Review reported on ${review.product.name}`,
        messages: { create: { authorId: userId, authorRole: "CUSTOMER", message: reason?.trim() || "This review may violate marketplace standards." } },
      },
    });
    return { reported: true, referenceNumber: complaint.referenceNumber };
  }

  async readImage(filename: string): Promise<{ bytes: Buffer; mimeType: string }> {
    if (!/^[0-9a-f-]+\.(?:jpe?g|png|webp)$/i.test(filename)) {
      throw new NotFoundException("Review image not found");
    }
    const mimeType = this.mimeTypeForFilename(filename);
    try {
      return {
        bytes: await this.storage.get(this.storageKey(filename)),
        mimeType,
      };
    }
    catch { throw new NotFoundException("Review image not found"); }
  }

  private async storeImages(files: Express.Multer.File[]): Promise<string[]> {
    if (!files.length) return [];
    const maxBytes = Number(this.config.get<string>('MAX_UPLOAD_BYTES', '5242880'));
    const urls: string[] = [];
    try {
      for (const file of files) {
        const extension = extname(file.originalname).toLowerCase();
        if (!REVIEW_IMAGE_TYPES.get(file.mimetype)?.has(extension)) throw new BadRequestException('Review images must be matching JPG, JPEG, PNG or WEBP files');
        if (file.size > maxBytes) throw new BadRequestException(`Review image must not exceed ${maxBytes} bytes`);
        const bytes = await this.optimizeImage(file.buffer);
        const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
        const filename = `${randomUUID()}-${digest}.webp`;
        await this.storage.put(this.storageKey(filename), bytes, "image/webp");
        urls.push(`/api/v1/review-images/${filename}`);
      }
    } catch (error) {
      await this.removeStoredImages(urls);
      throw error;
    }
    return urls;
  }

  private async removeStoredImages(urls: string[]) {
    await Promise.all(
      urls.flatMap((url) => {
        const filename = url.match(/^\/api\/v1\/review-images\/([0-9a-f-]+\.webp)$/i)?.[1];
        return filename
          ? [this.storage.remove(this.storageKey(filename)).catch(() => undefined)]
          : [];
      }),
    );
  }

  private async optimizeImage(input: Buffer): Promise<Buffer> {
    try {
      return await sharp(input, { failOn: "error" })
        .rotate()
        .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException("Review image file is invalid");
    }
  }

  private storageKey(filename: string): string {
    return `${REVIEW_IMAGE_KEY_PREFIX}/${filename}`;
  }

  private mimeTypeForFilename(filename: string): string {
    const extension = extname(filename).toLowerCase();
    return extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : "image/jpeg";
  }

  adminList() {
    return this.prisma.review.findMany({
      include: { customer: true, product: true, orderItem: true },
      orderBy: { createdAt: "desc" },
    });
  }

  vendorList(userId: string) {
    return this.prisma.review.findMany({
      where: { product: { vendor: { userId } } },
      select: {
        id: true, rating: true, comment: true, status: true, createdAt: true,
        product: { select: { id: true, name: true } },
        customer: { select: { firstName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  moderate(id: string, status: ReviewStatus) {
    if (status === ReviewStatus.PENDING) {
      throw new BadRequestException(
        "Moderation must publish or reject a review",
      );
    }
    return this.prisma.review.update({ where: { id }, data: { status } });
  }

  private present(review: {
    id: string;
    productId: string;
    orderItemId: string;
    rating: number;
    comment: string;
    status: ReviewStatus;
    images?: unknown;
    createdAt: Date;
  }) {
    return {
      id: review.id,
      productId: review.productId,
      orderItemId: review.orderItemId,
      rating: review.rating,
      comment: review.comment,
      images: Array.isArray(review.images) ? review.images.filter((image): image is string => typeof image === "string") : [],
      status: review.status,
      submittedAt: review.createdAt.toISOString(),
    };
  }
}
