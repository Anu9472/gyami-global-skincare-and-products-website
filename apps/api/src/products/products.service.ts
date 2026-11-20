import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ProductStatus, ReviewStatus, Role, VendorStatus } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { VendorsService } from "../vendors/vendors.service";
import type {
  CreateProductDto,
  ProductQueryDto,
  UpdateProductDto,
} from "./products.dto";
import { ProductImageStorageService } from "./product-image-storage.service";
import { NotificationsService } from "../notifications/notifications.service";
import { isUuid } from "../common/identifiers";

const publicProductSelect = {
  id: true,
  vendorId: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  productType: true,
  price: true,
  mrp: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  ingredients: true,
  specifications: true,
  approvedAt: true,
  category: { select: { name: true } },
  vendor: {
    select: {
      id: true,
      businessName: true,
      pickupPincode: true,
      _count: {
        select: {
          products: { where: { status: ProductStatus.APPROVED } },
        },
      },
    },
  },
  images: {
    orderBy: { sortOrder: "asc" as const },
    select: { url: true },
  },
  inventory: {
    select: { quantity: true, reserved: true, lowStockThreshold: true },
  },
} satisfies Prisma.ProductSelect;

type PublicProduct = Prisma.ProductGetPayload<{
  select: typeof publicProductSelect;
}>;

const productImageResponseSelect = {
  id: true,
  productId: true,
  url: true,
  altText: true,
  sortOrder: true,
  createdAt: true,
} satisfies Prisma.ProductImageSelect;

const ownedProductCategorySelect = {
  id: true,
  name: true,
} satisfies Prisma.CategorySelect;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendors: VendorsService,
    private readonly imageStorage: ProductImageStorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async uploadImages(
    userId: string,
    productId: string,
    files: Express.Multer.File[],
  ) {
    const product = await this.getOwned(userId, productId);
    if (!files.length) throw new BadRequestException("Select at least one product image");
    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.REJECTED
    ) {
      throw new BadRequestException(
        "Photos can only be changed before the product is submitted for approval",
      );
    }
    const optimized = await Promise.all(
      files.map((file) => this.imageStorage.optimize(file)),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId } });
      for (const [sortOrder, image] of optimized.entries()) {
        const id = randomUUID();
        await tx.productImage.create({
          data: {
            id,
            productId,
            sortOrder,
            url: this.imageStorage.publicUrl(id, image.digest),
            imageData: image.bytes,
            mimeType: image.mimeType,
          },
        });
      }
    });
    return this.getOwned(userId, productId);
  }

  async readImage(filename: string) {
    const imageId = this.imageStorage.imageIdFromFilename(filename);
    if (!imageId) throw new NotFoundException("Product image not found");
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
      select: { url: true, imageData: true, mimeType: true },
    });
    if (
      !image?.imageData ||
      !image.mimeType ||
      image.url !== `/api/v1/product-images/${filename}`
    ) {
      throw new NotFoundException("Product image not found");
    }
    return { bytes: Buffer.from(image.imageData), mimeType: image.mimeType };
  }

  async publicList(query: ProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.APPROVED,
      vendor: { status: VendorStatus.APPROVED },
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(query.category
        ? {
            category: {
              ...(isUuid(query.category)
                ? { OR: [{ id: query.category }, { slug: query.category }] }
                : { slug: query.category }),
            },
          }
        : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.productType ? { productType: query.productType } : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? { price: { gte: query.minPrice, lte: query.maxPrice } }
        : {}),
      ...(query.available
        ? { inventory: { is: { quantity: { gt: 0 } } } }
        : {}),
    };
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      query.sort === "PRICE_ASC"
        ? { price: "asc" }
        : query.sort === "PRICE_DESC"
          ? { price: "desc" }
          : query.sort === "POPULAR"
            ? { orderItems: { _count: "desc" } }
            : { createdAt: "desc" };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: publicProductSelect,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    const ratings = await this.ratingMaps(items);
    return {
      data: items.map((item) =>
        this.toPublic(
          item,
          ratings.products.get(item.id),
          ratings.vendors.get(item.vendorId),
        ),
      ),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async publicGet(idOrSlug: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        OR: isUuid(idOrSlug)
          ? [{ id: idOrSlug }, { slug: idOrSlug }]
          : [{ slug: idOrSlug }],
        status: ProductStatus.APPROVED,
        vendor: { status: VendorStatus.APPROVED },
      },
      select: publicProductSelect,
    });
    if (!product) throw new NotFoundException("Product not found");
    const ratings = await this.ratingMaps([product]);
    return this.toPublic(
      product,
      ratings.products.get(product.id),
      ratings.vendors.get(product.vendorId),
    );
  }

  async vendorList(userId: string, query: ProductQueryDto) {
    const vendorId = await this.vendors.getVendorId(userId);
    const where = {
      vendorId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: ownedProductCategorySelect },
          images: { orderBy: { sortOrder: "asc" }, select: productImageResponseSelect },
          inventory: true,
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async create(userId: string, input: CreateProductDto) {
    const vendor = await this.vendors.getByUser(userId);
    if (vendor.status !== VendorStatus.APPROVED)
      throw new ForbiddenException("Only approved vendors can create products");
    if (input.mrp !== undefined && input.mrp < input.price)
      throw new BadRequestException(
        "MRP cannot be lower than the selling price",
      );
    const slug = `${input.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${randomBytes(3).toString("hex")}`;
    const { stock, specifications, ...data } = input;
    return this.prisma.$transaction(async (tx) =>
      tx.product.create({
        data: {
          ...data,
          price: new Prisma.Decimal(input.price),
          mrp:
            input.mrp === undefined ? undefined : new Prisma.Decimal(input.mrp),
          gstRate: new Prisma.Decimal(input.gstRate),
          lengthCm:
            input.lengthCm === undefined
              ? undefined
              : new Prisma.Decimal(input.lengthCm),
          widthCm:
            input.widthCm === undefined
              ? undefined
              : new Prisma.Decimal(input.widthCm),
          heightCm:
            input.heightCm === undefined
              ? undefined
              : new Prisma.Decimal(input.heightCm),
          specifications: specifications,
          slug,
          vendorId: vendor.id,
          inventory: {
            create: {
              quantity: stock,
              transactions: {
                create: {
                  type: "INITIAL_STOCK",
                  quantity: stock,
                  balanceAfter: stock,
                  notes: "Initial stock from product creation",
                },
              },
            },
          },
        },
        include: {
          images: { orderBy: { sortOrder: "asc" }, select: productImageResponseSelect },
          inventory: true,
        },
      }),
    );
  }

  async getOwned(userId: string, id: string) {
    const vendorId = await this.vendors.getVendorId(userId);
    const product = await this.prisma.product.findFirst({
      where: { id, vendorId },
      include: {
        category: { select: ownedProductCategorySelect },
        images: { orderBy: { sortOrder: "asc" }, select: productImageResponseSelect },
        inventory: true,
      },
    });
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  async update(userId: string, id: string, input: UpdateProductDto) {
    const current = await this.getOwned(userId, id);
    if (
      current.status !== ProductStatus.DRAFT &&
      current.status !== ProductStatus.REJECTED
    )
      throw new BadRequestException(
        "Only draft or rejected products can be edited",
      );
    const { specifications, ...data } = input;
    return this.prisma.$transaction(async (tx) => {
      return tx.product.update({
        where: { id },
        data: {
          ...data,
          specifications: specifications,
          rejectionReason: null,
        },
        include: {
          images: { orderBy: { sortOrder: "asc" }, select: productImageResponseSelect },
          inventory: true,
        },
      });
    });
  }

  async submit(userId: string, id: string) {
    const product = await this.getOwned(userId, id);
    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.REJECTED
    )
      throw new BadRequestException(
        "Product cannot be submitted in its current state",
      );
    const optimizedImageCount = await this.prisma.productImage.count({
      where: {
        productId: id,
        imageData: { not: null },
        mimeType: "image/webp",
      },
    });
    if (!optimizedImageCount) {
      throw new BadRequestException(
        "Upload at least one optimized product photo before submitting for approval",
      );
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.PENDING_APPROVAL, rejectionReason: null },
    });
    const administrators = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    await Promise.all(
      administrators.map((administrator) =>
        this.notifications.createInApp(
          administrator.id,
          "PRODUCT_SUBMITTED_FOR_REVIEW",
          {
            productId: product.id,
            productName: product.name,
            vendorId: product.vendorId,
          },
          `product-review:${product.id}:${product.updatedAt.getTime()}:${administrator.id}`,
        ),
      ),
    );
    return updated;
  }
  async archive(userId: string, id: string) {
    await this.getOwned(userId, id);
    return this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED },
    });
  }

  private toPublic(
    product: PublicProduct,
    productRating = { rating: 0, reviewCount: 0 },
    vendorRating = 0,
  ) {
    const available = Math.max(
      0,
      (product.inventory?.quantity ?? 0) - (product.inventory?.reserved ?? 0),
    );
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      productType: product.productType,
      vendor: {
        id: product.vendor.id,
        name: product.vendor.businessName,
        location: product.vendor.pickupPincode ?? "",
        rating: vendorRating,
        productCount: product.vendor._count.products,
      },
      price: { amount: product.price.toNumber(), currency: "INR" },
      mrp: product.mrp
        ? { amount: product.mrp.toNumber(), currency: "INR" }
        : undefined,
      gstInclusive: true,
      weight: `${product.weightGrams} g`,
      dimensions:
        product.lengthCm || product.widthCm || product.heightCm
          ? {
              lengthCm: product.lengthCm?.toNumber(),
              widthCm: product.widthCm?.toNumber(),
              heightCm: product.heightCm?.toNumber(),
            }
          : undefined,
      description: product.description,
      ingredients: product.ingredients
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      specifications: product.specifications ?? {},
      images: product.images.map((image) => image.url.trim()).filter(Boolean),
      stockStatus:
        available === 0
          ? "OUT_OF_STOCK"
          : available <= (product.inventory?.lowStockThreshold ?? 5)
            ? "LOW_STOCK"
            : "IN_STOCK",
      availableQuantity: available,
      rating: productRating.rating,
      reviewCount: productRating.reviewCount,
      verified: Boolean(product.approvedAt),
      verifiedAt: product.approvedAt?.toISOString(),
      featured: false,
      bestSeller: false,
    };
  }

  private async ratingMaps(products: PublicProduct[]) {
    const productIds = products.map((product) => product.id);
    const vendorIds = [...new Set(products.map((product) => product.vendorId))];
    if (!productIds.length) {
      return {
        products: new Map<string, { rating: number; reviewCount: number }>(),
        vendors: new Map<string, number>(),
      };
    }

    const [productRatings, vendorReviews] = await Promise.all([
      this.prisma.review.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          status: ReviewStatus.PUBLISHED,
        },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.review.findMany({
        where: {
          status: ReviewStatus.PUBLISHED,
          product: {
            vendorId: { in: vendorIds },
            status: ProductStatus.APPROVED,
          },
        },
        select: {
          rating: true,
          product: { select: { vendorId: true } },
        },
      }),
    ]);

    const productMap = new Map(
      productRatings.map((entry) => [
        entry.productId,
        {
          rating: entry._avg.rating ?? 0,
          reviewCount: entry._count.rating,
        },
      ]),
    );
    const vendorTotals = new Map<string, { total: number; count: number }>();
    vendorReviews.forEach((review) => {
      const current = vendorTotals.get(review.product.vendorId) ?? {
        total: 0,
        count: 0,
      };
      current.total += review.rating;
      current.count += 1;
      vendorTotals.set(review.product.vendorId, current);
    });
    const vendorMap = new Map(
      [...vendorTotals].map(([vendorId, summary]) => [
        vendorId,
        summary.count ? summary.total / summary.count : 0,
      ]),
    );
    return { products: productMap, vendors: vendorMap };
  }
}
