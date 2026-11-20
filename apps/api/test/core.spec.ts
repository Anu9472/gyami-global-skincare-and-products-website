import {
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { JwtService } from "@nestjs/jwt";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InspectionStatus,
  ComplaintCategory,
  NotificationStatus,
  OrderStatus,
  ProductStatus,
  Role,
  UserStatus,
  VendorDocumentType,
  VerificationOtpPurpose,
  VendorStatus,
  VendorSuspensionReason,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { compare, hash } from "bcryptjs";
import { validate } from "class-validator";
import { firstValueFrom, of } from "rxjs";
import sharp from "sharp";
import { AdminService } from "../src/admin/admin.service";
import { AuthService } from "../src/auth/auth.service";
import { RegisterDto } from "../src/auth/auth.dto";
import { JwtStrategy } from "../src/auth/jwt.strategy";
import type { CustomerOtpProvider } from "../src/auth/customer-otp-provider";
import { createRequestId } from "../src/common/request-id.middleware";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import {
  accessLogSeverity,
  requestPathForLog,
} from "../src/common/request-logging.middleware";
import { validateEnvironment } from "../src/config/environment";
import type { PrismaService } from "../src/database/prisma.service";
import { PrivateObjectStorageService } from "../src/storage/private-object-storage.service";
import { hasExpectedFileSignature } from "../src/storage/file-signature";
import { HealthController } from "../src/health.controller";
import { ReviewsService } from "../src/reviews/reviews.service";
import { CategoriesService } from "../src/categories/categories.service";
import { HomeHeroService } from "../src/home-hero/home-hero.service";
import type { VendorsService } from "../src/vendors/vendors.service";
import { OrdersService } from "../src/orders/orders.service";
import { ProductImageStorageService } from "../src/products/product-image-storage.service";
import type { NotificationsService } from "../src/notifications/notifications.service";
import { NotificationsService as NotificationsServiceImpl } from "../src/notifications/notifications.service";
import { VendorInspectionsService } from "../src/vendor-inspections/vendor-inspections.service";
import { ShippingService } from "../src/shipments/shipments.service";
import { ShipmentWebhooksController } from "../src/shipments/shipments.controller";
import { PaymentWebhooksController } from "../src/payments/payments.controller";
import type { IntegrationSettingsService } from "../src/integration-settings/integration-settings.service";
import { ProductsService } from "../src/products/products.service";
import { GoogleIdentityService } from "../src/auth/google-identity.service";
import { NoStoreResponseInterceptor } from "../src/common/no-store-response.interceptor";
import { noStoreAuthorizedResponseMiddleware } from "../src/common/no-store-authorized-response.middleware";
import { VendorFilterDto } from "../src/common/vendor-filter.dto";
import { ApplicationLifecycleService } from "../src/common/application-lifecycle.service";
import { VendorDocumentsService } from "../src/vendor-documents/vendor-documents.service";
import { ComplaintsService } from "../src/complaints/complaints.service";
import { ReturnsService } from "../src/returns/returns.service";
import {
  MetricsController,
  metricsTokenMatches,
} from "../src/metrics/metrics.controller";
import { MetricsService } from "../src/metrics/metrics.service";

describe("platform security rules", () => {
  it("rejects missing raw webhook bodies as a client-visible configuration error", () => {
    const paymentWebhook = new PaymentWebhooksController({ webhook: vi.fn() } as any);
    const shipmentWebhook = new ShipmentWebhooksController(
      { shiprocketWebhook: vi.fn() } as any,
    );

    expect(() => paymentWebhook.webhook({} as any, "signature")).toThrow(
      BadRequestException,
    );
    expect(() => shipmentWebhook.webhook({} as any, "secret")).toThrow(
      BadRequestException,
    );
  });

  it("enforces the same password strength during registration as reset flows", async () => {
    const weak = Object.assign(new RegisterDto(), { password: "onlylowercase" });
    const weakErrors = await validate(weak);
    const passwordError = weakErrors.find((error) => error.property === "password");
    expect(passwordError?.constraints).toMatchObject({
      matches: "Password must include an uppercase letter",
    });

    const strong = Object.assign(new RegisterDto(), { password: "SecurePassword2" });
    const strongErrors = await validate(strong);
    expect(strongErrors.find((error) => error.property === "password")).toBeUndefined();
  });

  it("rejects malformed vendor-scoped finance filters before querying the database", async () => {
    const query = Object.assign(new VendorFilterDto(), {
      vendorId: "not-a-vendor-id",
    });
    const errors = await validate(query);

    expect(errors.find((error) => error.property === "vendorId")?.constraints).toHaveProperty(
      "isUuid",
    );
  });

  it("marks authentication and private-response handlers as non-cacheable", async () => {
    const setHeader = vi.fn();
    const interceptor = new NoStoreResponseInterceptor();
    const result = interceptor.intercept(
      {
        switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
      } as unknown as import("@nestjs/common").ExecutionContext,
      { handle: () => of({ token: "sensitive" }) },
    );

    await expect(firstValueFrom(result)).resolves.toEqual({ token: "sensitive" });
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("marks every bearer-authorized response as non-cacheable", () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    noStoreAuthorizedResponseMiddleware(
      { header: vi.fn().mockReturnValue("Bearer access-token") } as any,
      { setHeader } as any,
      next,
    );
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(next).toHaveBeenCalledOnce();

    noStoreAuthorizedResponseMiddleware(
      { header: vi.fn().mockReturnValue(undefined) } as any,
      { setHeader } as any,
      next,
    );
    expect(setHeader).toHaveBeenCalledTimes(1);
  });

  it("separates process liveness from database-backed readiness", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
    const controller = new HealthController({
      $queryRaw: queryRaw,
    } as unknown as PrismaService, {
      readiness: vi.fn().mockResolvedValue(undefined),
    } as unknown as PrivateObjectStorageService, new ApplicationLifecycleService());

    expect(controller.liveness()).toEqual({ status: "ok" });
    await expect(controller.ready()).resolves.toEqual({
      status: "ok",
      database: "connected",
      rateLimitStore: "not-configured",
      documentStorage: "connected",
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("includes the distributed rate-limit store in readiness when configured", async () => {
    const ping = vi.fn().mockResolvedValue("PONG");
    const controller = new HealthController(
      { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) } as unknown as PrismaService,
      { readiness: vi.fn().mockResolvedValue(undefined) } as unknown as PrivateObjectStorageService,
      new ApplicationLifecycleService(),
      { ping },
    );

    await expect(controller.readiness()).resolves.toEqual({
      status: "ok",
      database: "connected",
      rateLimitStore: "connected",
      documentStorage: "connected",
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("keeps the stricter launch gate opt-in outside production", async () => {
    const controller = new HealthController(
      { $queryRaw: vi.fn() } as unknown as PrismaService,
      { readiness: vi.fn() } as unknown as PrivateObjectStorageService,
      new ApplicationLifecycleService(),
    );

    await expect(controller.launchReadiness()).resolves.toEqual({
      status: "not-required",
    });
  });

  it("requires every live integration before production launch readiness passes", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const has = vi.fn().mockResolvedValue(true);
      const controller = new HealthController(
        { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) } as unknown as PrismaService,
        { readiness: vi.fn().mockResolvedValue(undefined) } as unknown as PrivateObjectStorageService,
        new ApplicationLifecycleService(),
        undefined,
        { has } as unknown as IntegrationSettingsService,
      );

      await expect(controller.launchReadiness()).resolves.toEqual({ status: "ok" });
      expect(has).toHaveBeenCalledTimes(10);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("rejects production launch readiness when a live integration is missing", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const has = vi.fn().mockResolvedValue(false);
      const controller = new HealthController(
        { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) } as unknown as PrismaService,
        { readiness: vi.fn().mockResolvedValue(undefined) } as unknown as PrivateObjectStorageService,
        new ApplicationLifecycleService(),
        undefined,
        { has } as unknown as IntegrationSettingsService,
      );

      await expect(controller.launchReadiness()).rejects.toThrow(
        "Launch integrations are not configured",
      );
      expect(has).toHaveBeenCalledTimes(10);
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("fails readiness when private document storage is unavailable", async () => {
    const controller = new HealthController(
      { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) } as unknown as PrismaService,
      { readiness: vi.fn().mockRejectedValue(new Error("bucket unavailable")) } as unknown as PrivateObjectStorageService,
      new ApplicationLifecycleService(),
    );

    await expect(controller.ready()).rejects.toThrow("Document storage is unavailable");
  });

  it("removes a terminating process from readiness before shutdown", async () => {
    const lifecycle = new ApplicationLifecycleService();
    const controller = new HealthController(
      { $queryRaw: vi.fn() } as unknown as PrismaService,
      { readiness: vi.fn() } as unknown as PrivateObjectStorageService,
      lifecycle,
    );

    lifecycle.beforeApplicationShutdown();

    await expect(controller.ready()).rejects.toThrow("Application is shutting down");
  });

  it("preserves a safe caller-supplied request ID and replaces unsafe values", () => {
    expect(createRequestId("checkout_8F4k-2r9")).toBe("checkout_8F4k-2r9");
    expect(createRequestId("<script>alert(1)</script>")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("removes query data from structured access-log paths", () => {
    expect(requestPathForLog("/api/v1/products?search=private%20term")).toBe(
      "/api/v1/products",
    );
  });

  it("elevates failed and slow requests in structured access logs", () => {
    expect(accessLogSeverity(200, 42)).toBe("log");
    expect(accessLogSeverity(404, 42)).toBe("warn");
    expect(accessLogSeverity(200, 1_000)).toBe("warn");
    expect(accessLogSeverity(503, 42)).toBe("error");
  });

  it("renders bounded process metrics for a Prometheus-compatible scraper", () => {
    const metrics = new MetricsService();
    metrics.requestStarted();
    metrics.requestFinished("GET", 200, 12.3456);

    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain("gyami_global_process_uptime_seconds ");
    expect(rendered).toContain("gyami_global_http_in_flight_requests 0");
    expect(rendered).toContain(
      'gyami_global_http_requests_total{method="GET",status_code="200"} 1',
    );
    expect(rendered).toContain(
      'gyami_global_http_request_duration_milliseconds_sum{method="GET",status_code="200"} 12.346',
    );
  });

  it("protects operational metrics with a dedicated scraper token", () => {
    const metrics = new MetricsService();
    const get = vi.fn((key: string) =>
      ({ METRICS_AUTH_TOKEN: "metrics-token", NODE_ENV: "production" })[key],
    );
    const controller = new MetricsController(
      { get } as unknown as ConfigService,
      metrics,
    );
    const type = vi.fn().mockReturnThis();
    const send = vi.fn();
    const response = { type, send };

    expect(() =>
      controller.metricsEndpoint(
        { header: vi.fn().mockReturnValue("wrong-token") } as any,
        response as any,
      ),
    ).toThrow("Metrics authentication failed");

    controller.metricsEndpoint(
      { header: vi.fn().mockReturnValue("metrics-token") } as any,
      response as any,
    );
    expect(type).toHaveBeenCalledWith("text/plain; version=0.0.4; charset=utf-8");
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("gyami_global_process_uptime_seconds"),
    );
    expect(metricsTokenMatches("metrics-token", "metrics-token")).toBe(true);
    expect(metricsTokenMatches("metrics-token", "metrics-token-extra")).toBe(false);
    expect(metricsTokenMatches(undefined, "metrics-token")).toBe(false);
  });

  it("removes query data from unexpected-error logs", () => {
    const error = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const filter = new ApiExceptionFilter();
    (
      filter as unknown as { logger: { error: typeof error } }
    ).logger = { error };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          originalUrl: "/api/v1/auth/reset?token=private-reset-token",
        }),
        getResponse: () => ({
          locals: { requestId: "safe-request-id" },
          status,
          json,
        }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new Error("unexpected"), host);

    expect(error).toHaveBeenCalledWith(
      expect.not.stringContaining("private-reset-token"),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("GET /api/v1/auth/reset [safe-request-id]"),
    );
    expect(status).toHaveBeenCalledWith(500);
  });

  it("rejects private uploads whose bytes do not match the declared file type", () => {
    expect(
      hasExpectedFileSignature(Buffer.from("not a PDF"), "application/pdf"),
    ).toBe(false);
    expect(
      hasExpectedFileSignature(Buffer.from("%PDF-1.7"), "application/pdf"),
    ).toBe(true);
    expect(
      hasExpectedFileSignature(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe(true);
  });

  it("normalizes review photos into durable object storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "gyami-global-review-images-"));
    const values: Record<string, string> = {
      DOCUMENT_STORAGE_PROVIDER: "local",
      PRIVATE_UPLOAD_DIR: root,
      MAX_UPLOAD_BYTES: "5242880",
    };
    const config = {
      get: (key: string, fallback?: string) => values[key] ?? fallback,
      getOrThrow: (key: string) => {
        const value = values[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
      },
    } as unknown as ConfigService;
    const storage = new PrivateObjectStorageService(config);
    const reviews = new ReviewsService(
      {} as PrismaService,
      config,
      storage,
    );
    const png = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 18, g: 96, b: 54 },
      },
    })
      .png()
      .toBuffer();
    try {
      const urls = await (reviews as any).storeImages([
        {
          buffer: png,
          size: png.length,
          mimetype: "image/png",
          originalname: "feedback.png",
        },
      ]);
      expect(urls).toHaveLength(1);
      const filename = urls[0].split("/").at(-1);
      await expect(reviews.readImage(filename)).resolves.toMatchObject({
        mimeType: "image/webp",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes uploaded review images when the review record cannot be saved", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = new ReviewsService(
      {
        orderItem: {
          findFirst: vi.fn().mockResolvedValue({
            id: "order-item-id",
            status: OrderStatus.DELIVERED,
            vendorOrder: { masterOrder: { customer: { id: "customer-id" } } },
          }),
        },
        review: { create: vi.fn().mockRejectedValue(new Error("database unavailable")) },
      } as unknown as PrismaService,
      { get: vi.fn((_key: string, fallback?: string) => fallback) } as unknown as ConfigService,
      { put, remove } as unknown as PrivateObjectStorageService,
    );
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#155631" },
    }).png().toBuffer();

    await expect(
      service.create(
        "customer-user",
        "product-id",
        { orderItemId: "order-item-id", rating: 5, comment: "Excellent" } as any,
        [{ originalname: "review.png", mimetype: "image/png", size: image.length, buffer: image } as Express.Multer.File],
      ),
    ).rejects.toThrow("database unavailable");
    expect(remove).toHaveBeenCalledWith(
      expect.stringMatching(/^review-images\/[0-9a-f-]+-[0-9a-f]{16}\.webp$/),
    );
  });

  it("normalizes vendor product photos to a fixed square WebP card ratio", async () => {
    const source = await sharp({
      create: {
        width: 1400,
        height: 600,
        channels: 3,
        background: { r: 193, g: 117, b: 42 },
      },
    })
      .png()
      .toBuffer();
    const images = new ProductImageStorageService({
      get: vi.fn((_key: string, fallback?: string) => fallback),
    } as unknown as ConfigService);

    const optimized = await images.optimize({
      buffer: source,
      size: source.length,
      mimetype: "image/png",
      originalname: "wide-millet-mix.png",
    } as Express.Multer.File);
    const metadata = await sharp(optimized.bytes).metadata();

    expect(optimized.mimeType).toBe("image/webp");
    expect(metadata.width).toBe(900);
    expect(metadata.height).toBe(900);
  });

  it("makes deduplicated in-app notifications safe to repeat", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "notification-id" });
    const service = new NotificationsServiceImpl(
      { notification: { upsert } } as unknown as PrismaService,
      {} as any,
      {} as ConfigService,
      {} as any,
    );

    await expect(
      service.createInApp(
        "vendor-user",
        "VENDOR_REJECTED",
        { reason: "Incomplete KYC" },
        "vendor-rejected:vendor-1:event-1",
      ),
    ).resolves.toEqual({ id: "notification-id" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dedupeKey: "vendor-rejected:vendor-1:event-1" },
        create: expect.objectContaining({ channel: "IN_APP" }),
        update: expect.objectContaining({
          status: NotificationStatus.SENT,
          failureReason: null,
        }),
      }),
    );
  });

  it("returns a clear conflict when a category slug races with another request", async () => {
    const categories = new CategoriesService(
      {
        category: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockRejectedValue({ code: "P2002" }),
        },
      } as unknown as PrismaService,
      {} as any,
    );

    await expect(
      categories.create({ name: "Millets", slug: "millets" }),
    ).rejects.toThrow("A category with this name already exists");
  });

  it("uses a slug-only category predicate for public non-UUID URLs", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const categories = new CategoriesService(
      { category: { findFirst } } as unknown as PrismaService,
      {} as any,
    );

    await expect(categories.get("millets")).rejects.toThrow(
      "Category not found",
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: "millets", isActive: true },
      }),
    );
  });

  it("keeps new hero slides inactive until they have an uploaded image", async () => {
    const create = vi.fn().mockResolvedValue({ id: "slide-id" });
    const hero = new HomeHeroService(
      { homeHeroSlide: { create } } as unknown as PrismaService,
      {} as any,
    );

    await hero.create({
      eyebrow: "Local producers",
      title: "Fresh marketplace food",
      description: "Traceable products from approved vendors.",
      ctaLabel: "Shop",
      ctaHref: "/products",
      imageAlt: "A food basket",
      isActive: true,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
  });

  it("does not allow an image-less hero slide to become active", async () => {
    const hero = new HomeHeroService(
      {
        homeHeroSlide: {
          findUnique: vi.fn().mockResolvedValue({ id: "slide-id", imageUrl: null }),
        },
      } as unknown as PrismaService,
      {} as any,
    );

    await expect(hero.update("slide-id", { isActive: true })).rejects.toThrow(
      "Upload a hero image before activating this slide",
    );
  });

  it("temporarily locks an account after repeated failed password attempts", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({ failedLoginAttempts: 5 })
      .mockResolvedValueOnce({ id: "customer-user" });
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: "customer-user",
          passwordHash: await hash("CorrectPassword1!", 4),
          status: UserStatus.ACTIVE,
          role: Role.CUSTOMER,
          mobileVerifiedAt: new Date(),
          lockedUntil: null,
        }),
        update,
      },
    } as unknown as PrismaService;
    const config = {
      get: vi.fn((key: string, fallback?: string) =>
        key === "LOGIN_MAX_FAILURES" ? "5" : fallback,
      ),
    } as unknown as ConfigService;
    const service = new AuthService(prisma, {} as JwtService, config);

    await expect(
      service.login({
        emailOrMobile: "customer@example.com",
        password: "WrongPassword1!",
      }),
    ).rejects.toThrow("Invalid credentials");

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "customer-user" },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "customer-user" },
        data: expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: expect.any(Date),
        }),
      }),
    );
  });

  it("creates a customer session only after Google identity verification", async () => {
    const verify = vi.fn().mockResolvedValue({
      email: "new.google.customer@example.com",
      firstName: "New",
      lastName: "Customer",
    });
    const createdUser = {
      id: "google-customer-user",
      email: "new.google.customer@example.com",
      mobile: null,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
      passwordHash: "hash",
      emailVerifiedAt: new Date(),
      mobileVerifiedAt: null,
      lastLoginAt: new Date(),
      refreshTokenHash: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const create = vi.fn().mockResolvedValue(createdUser);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(createdUser),
      },
      customerProfile: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "google-customer-profile",
          firstName: "New",
          lastName: "Customer",
        }),
      },
      $transaction: vi.fn((operation: (tx: { user: { create: typeof create } }) => unknown) =>
        operation({ user: { create } }),
      ),
    } as unknown as PrismaService;
    const jwt = {
      signAsync: vi.fn().mockResolvedValueOnce("access").mockResolvedValueOnce("refresh"),
    } as unknown as JwtService;
    const config = {
      get: vi.fn((_key: string, fallback?: string) => fallback),
      getOrThrow: vi.fn(() => "a-secure-test-secret-that-is-long-enough"),
    } as unknown as ConfigService;
    const service = new AuthService(
      prisma,
      jwt,
      config,
      undefined,
      undefined,
      { verify } as unknown as GoogleIdentityService,
    );

    await expect(service.googleLogin("verified-google-id-token")).resolves.toMatchObject({
      accessToken: "access",
      customer: { email: "new.google.customer@example.com", role: Role.CUSTOMER },
    });
    expect(verify).toHaveBeenCalledWith("verified-google-id-token");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new.google.customer@example.com",
          emailVerifiedAt: expect.any(Date),
          role: Role.CUSTOMER,
        }),
      }),
    );
  });

  it("does not attempt Google verification without a configured OAuth audience", async () => {
    const service = new GoogleIdentityService({
      get: vi.fn(() => undefined),
    } as unknown as ConfigService);
    await expect(service.verify("untrusted-token")).rejects.toThrow(
      "Google sign-in is not configured",
    );
  });

  it("rejects a suspended user on every protected-token validation", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "suspended-vendor",
          role: Role.VENDOR,
          status: UserStatus.SUSPENDED,
          email: "vendor@example.com",
          mobile: null,
        }),
      },
    } as unknown as PrismaService;
    const strategy = new JwtStrategy(
      {
        getOrThrow: vi.fn().mockReturnValue("a-secure-test-secret-that-is-long-enough"),
      } as unknown as ConfigService,
      prisma,
    );

    await expect(
      strategy.validate({
        sub: "suspended-vendor",
        role: Role.VENDOR,
        type: "access",
      }),
    ).rejects.toThrow("Account is not active");
  });

  it("does not let a suspended user renew an existing refresh session", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "suspended-vendor",
          status: UserStatus.SUSPENDED,
          refreshTokenHash: await hash("previous-refresh-token", 4),
        }),
      },
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {
        verifyAsync: vi.fn().mockResolvedValue({
          sub: "suspended-vendor",
          type: "refresh",
        }),
      } as unknown as JwtService,
      {
        getOrThrow: vi.fn().mockReturnValue("a-secure-test-secret-that-is-long-enough"),
      } as unknown as ConfigService,
    );

    await expect(
      service.refresh({ refreshToken: "previous-refresh-token" }),
    ).rejects.toThrow("Refresh token has been revoked");
  });

  it("rejects administrator self-registration before database access", async () => {
    const service = new AuthService(
      {} as PrismaService,
      {} as JwtService,
      {} as ConfigService,
    );
    await expect(
      service.register({
        role: Role.ADMIN,
        email: "admin@example.com",
        password: "not-used-password",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("requires a six-digit pickup pincode for vendor registration", async () => {
    const service = new AuthService(
      {} as PrismaService,
      {} as JwtService,
      {} as ConfigService,
    );
    await expect(
      service.register({
        role: Role.VENDOR,
        email: "vendor@example.com",
        password: "not-used-password",
        businessName: "Vendor",
        ownerName: "Owner",
        businessAddress: {
          line1: "Market road",
          city: "Buldhana",
          state: "Maharashtra",
        },
      }),
    ).rejects.toThrow("valid 6-digit vendor pickup pincode");
  });

  it("does not reveal whether a password-reset account exists", async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      { signAsync: vi.fn().mockResolvedValue("opaque-challenge") } as unknown as JwtService,
      {
        get: vi.fn((_key: string, fallback?: unknown) => fallback),
        getOrThrow: vi.fn().mockReturnValue("a-secure-test-secret-that-is-long-enough"),
      } as unknown as ConfigService,
    );
    await expect(
      service.forgotPassword({ emailOrMobile: "missing@example.com" }),
    ).resolves.toEqual(expect.objectContaining({
      message:
        "If the account exists, reset instructions will be sent securely.",
      challengeToken: "opaque-challenge",
    }));
  });

  it("rejects an expired password-reset token", async () => {
    const prisma = {
      passwordResetToken: {
        findUnique: vi.fn().mockResolvedValue({
          userId: "user-id",
          usedAt: null,
          expiresAt: new Date(Date.now() - 1_000),
        }),
      },
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      {} as ConfigService,
    );
    await expect(
      service.resetPassword({ token: "expired", password: "StrongPass1" }),
    ).rejects.toThrow("invalid or has expired");
  });

  it("changes a vendor password securely and revokes refresh/reset sessions", async () => {
    const update = vi.fn().mockResolvedValue({ id: "vendor-user" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "vendor-user",
          role: Role.VENDOR,
          passwordHash: await hash("CurrentPass1", 12),
        }),
        update,
      },
      passwordResetToken: { updateMany },
      $transaction: vi.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      {} as ConfigService,
    );

    await expect(
      service.changeVendorPassword("vendor-user", {
        currentPassword: "CurrentPass1",
        newPassword: "NewVendorPass2",
        confirmNewPassword: "NewVendorPass2",
      }),
    ).resolves.toEqual({
      message: "Password changed successfully. Please sign in again.",
      requiresReauthentication: true,
    });

    const [updateInput] = update.mock.calls[0] as unknown as [
      { data: { passwordHash: string; refreshTokenHash: null } },
    ];
    expect(await compare("NewVendorPass2", updateInput.data.passwordHash)).toBe(
      true,
    );
    expect(updateInput.data.refreshTokenHash).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "vendor-user", usedAt: null } }),
    );
  });

  it("rejects a vendor password change when the current password is wrong", async () => {
    const update = vi.fn();
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "vendor-user",
          role: Role.VENDOR,
          passwordHash: await hash("CurrentPass1", 12),
        }),
        update,
      },
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      {} as ConfigService,
    );

    await expect(
      service.changeVendorPassword("vendor-user", {
        currentPassword: "WrongPass1",
        newPassword: "NewVendorPass2",
        confirmNewPassword: "NewVendorPass2",
      }),
    ).rejects.toThrow("Current password is incorrect");
    expect(update).not.toHaveBeenCalled();
  });

  it("does not allow a non-vendor to use vendor password management", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "customer-user",
          role: Role.CUSTOMER,
          passwordHash: "unused",
        }),
      },
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      {} as ConfigService,
    );

    await expect(
      service.changeVendorPassword("customer-user", {
        currentPassword: "CurrentPass1",
        newPassword: "NewVendorPass2",
        confirmNewPassword: "NewVendorPass2",
      }),
    ).rejects.toThrow("Vendor account access is required");
  });

  it("verifies a one-time code and consumes it while marking the mobile verified", async () => {
    const consumed = vi.fn().mockResolvedValue({ count: 1 });
    const verifyUser = vi.fn().mockResolvedValue({});
    const transactionClient = {
      verificationOtp: { updateMany: consumed },
      user: { update: verifyUser },
    };
    const prisma = {
      verificationOtp: {
        findFirst: vi.fn().mockResolvedValue({
          id: "otp-id",
          codeHash: await hash("123456", 12),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
        }),
      },
      $transaction: vi.fn(
        (operation: (tx: typeof transactionClient) => Promise<unknown>) =>
          operation(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new AuthService(prisma, {} as JwtService, {} as ConfigService);

    await expect(service.verifyOtp("user-id", { code: "123456" })).resolves.toEqual({
      message: "Mobile number verified successfully",
      verified: true,
    });
    expect(consumed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "otp-id", consumedAt: null },
      }),
    );
    expect(verifyUser).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-id" } }));
  });

  it("rejects a verification code that another request already consumed", async () => {
    const verifyUser = vi.fn();
    const transactionClient = {
      verificationOtp: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: { update: verifyUser },
    };
    const prisma = {
      verificationOtp: {
        findFirst: vi.fn().mockResolvedValue({
          id: "otp-id",
          codeHash: await hash("123456", 12),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
        }),
      },
      $transaction: vi.fn(
        (operation: (tx: typeof transactionClient) => Promise<unknown>) =>
          operation(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new AuthService(prisma, {} as JwtService, {} as ConfigService);

    await expect(service.verifyOtp("user-id", { code: "123456" })).rejects.toThrow(
      "invalid or expired",
    );
    expect(verifyUser).not.toHaveBeenCalled();
  });

  it("creates the existing customer session only after the public OTP challenge is verified", async () => {
    const user = {
      id: "customer-user",
      email: "customer@example.com",
      mobile: "9876543210",
      mobileVerifiedAt: null,
      passwordHash: await hash("StrongPass1", 12),
      refreshTokenHash: null,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
    };
    const updateUser = vi.fn().mockResolvedValue(user);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        update: updateUser,
      },
      customerProfile: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "customer-profile",
          firstName: "Customer",
          lastName: "One",
        }),
      },
      verificationOtp: {
        findFirst: vi.fn().mockResolvedValue({
          id: "otp-id",
          codeHash: await hash("123456", 12),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
        }),
      },
    } as unknown as PrismaService;
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: user.id,
        type: "customer_account_verification",
      }),
      signAsync: vi.fn()
        .mockResolvedValueOnce("access-token")
        .mockResolvedValueOnce("refresh-token"),
    } as unknown as JwtService;
    const config = {
      get: vi.fn((_key: string, fallback?: unknown) => fallback),
      getOrThrow: vi.fn().mockReturnValue("a-secure-test-secret-that-is-long-enough"),
    } as unknown as ConfigService;
    const verifyAccessToken = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new BadRequestException("Verification code is invalid or expired"));
    const service = new AuthService(
      prisma,
      jwt,
      config,
      undefined,
      { verifyAccessToken } as unknown as CustomerOtpProvider,
    );

    await expect(service.verifyCustomerAccountOtp("challenge", "123456"))
      .resolves.toMatchObject({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        customer: { id: "customer-profile", mobileVerified: true },
      });
    await expect(service.verifyCustomerAccountOtp("challenge", "123456"))
      .rejects.toThrow("invalid or expired");
    expect(verifyAccessToken).toHaveBeenCalledWith("123456", "9876543210");
  });

  it("counts an invalid one-time-code attempt without exposing the expected code", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      verificationOtp: {
        findFirst: vi.fn().mockResolvedValue({
          id: "otp-id",
          codeHash: await hash("123456", 12),
          expiresAt: new Date(Date.now() + 60_000),
          attempts: 0,
        }),
        update,
      },
    } as unknown as PrismaService;
    const service = new AuthService(prisma, {} as JwtService, {} as ConfigService);

    await expect(service.verifyOtp("user-id", { code: "654321" })).rejects.toThrow("invalid or expired");
    expect(update).toHaveBeenCalledWith({ where: { id: "otp-id" }, data: { attempts: { increment: 1 } } });
  });

  it("stores only a hash and sends the generated verification code through SMS", async () => {
    const create = vi.fn().mockResolvedValue({});
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const sendSms = vi.fn().mockResolvedValue({
      status: NotificationStatus.SENT,
    });
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-id",
          mobile: "9876543210",
          mobileVerifiedAt: null,
          vendor: null,
        }),
      },
      verificationOtp: { create, deleteMany, findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaService;
    const config = {
      get: vi.fn((key: string, fallback: string) =>
        key === "NODE_ENV" ? "development" : fallback,
      ),
    } as unknown as ConfigService;
    const notifications = { sendSms } as unknown as NotificationsService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      config,
      notifications,
    );

    const result = await service.requestVerificationOtp("user-id");
    const smsDelivery = sendSms.mock.calls[0]?.[3] as
      | { otp: string; expiresInMinutes: number }
      | undefined;
    const deliveredOtp = smsDelivery?.otp ?? "";
    const createInput = create.mock.calls[0]?.[0] as
      | { data: { codeHash: string } }
      | undefined;
    const storedHash = createInput?.data.codeHash ?? "";

    expect(sendSms).toHaveBeenCalledWith(
      "user-id",
      "customer_registration_otp",
      { expiresInMinutes: 5 },
      smsDelivery,
    );
    expect(deliveredOtp).toMatch(/^\d{6}$/);
    expect(storedHash).not.toBe(deliveredOtp);
    await expect(compare(deliveredOtp, storedHash)).resolves.toBe(true);
    expect(result).toMatchObject({ message: "Verification code sent securely" });
    expect(result).not.toHaveProperty("developmentOtp");
  });

  it("removes the challenge and reports failure when OTP delivery fails", async () => {
    const deleteMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-id",
          mobile: "9876543210",
          mobileVerifiedAt: null,
          vendor: null,
        }),
      },
      verificationOtp: {
        create: vi.fn().mockResolvedValue({}),
        deleteMany,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaService;
    const config = {
      get: vi.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService;
    const notifications = {
      sendSms: vi.fn().mockResolvedValue(null),
    } as unknown as NotificationsService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      config,
      notifications,
    );

    await expect(service.requestVerificationOtp("user-id")).rejects.toThrow(
      "could not be delivered",
    );
    expect(deleteMany).toHaveBeenLastCalledWith({
      where: {
        userId: "user-id",
        purpose: VerificationOtpPurpose.ACCOUNT_VERIFICATION,
        consumedAt: null,
      },
    });
  });

  it("uses the MSG91 widget rather than WhatsApp for a customer password-reset OTP", async () => {
    const sendSms = vi.fn();
    const sendWhatsApp = vi.fn();
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: "customer-user",
          email: "customer@example.com",
          mobile: "9876543210",
          role: Role.CUSTOMER,
          status: UserStatus.ACTIVE,
        }),
      },
    } as unknown as PrismaService;
    const jwt = {
      signAsync: vi.fn().mockResolvedValue("password-reset-challenge"),
    } as unknown as JwtService;
    const config = {
      get: vi.fn((_key: string, fallback?: unknown) => fallback),
      getOrThrow: vi.fn().mockReturnValue("a-secure-test-secret-that-is-long-enough"),
    } as unknown as ConfigService;
    const notifications = { sendSms, sendWhatsApp } as unknown as NotificationsService;
    const getClientConfiguration = vi.fn().mockResolvedValue({
      provider: "MSG91_WIDGET",
      widgetId: "widget-id",
      tokenAuth: "browser-token",
      identifier: "919876543210",
    });
    const service = new AuthService(
      prisma,
      jwt,
      config,
      notifications,
      { getClientConfiguration } as unknown as CustomerOtpProvider,
    );

    await expect(service.forgotPassword({ emailOrMobile: "customer@example.com" }))
      .resolves.toMatchObject({
        challengeToken: "password-reset-challenge",
        otp: { provider: "MSG91_WIDGET", identifier: "919876543210" },
      });
    expect(getClientConfiguration).toHaveBeenCalledWith("9876543210");
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it("requires independent strong JWT secrets and field encryption", () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: "postgresql://db",
        JWT_ACCESS_SECRET: "short",
        JWT_REFRESH_SECRET: "short",
        BANK_DATA_ENCRYPTION_KEY: "bad",
        CORS_ORIGINS: "http://localhost:5173",
      }),
    ).toThrow();
  });

  it("uses a bounded trusted-proxy configuration for client-aware rate limiting", () => {
    const local = validateEnvironment({
      DATABASE_URL: "postgresql://db",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
      BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
      CORS_ORIGINS: "http://localhost:5173",
    });
    expect(local.TRUST_PROXY_HOPS).toBe("0");
    expect(() => validateEnvironment({
      ...local,
      TRUST_PROXY_HOPS: "outside-the-network",
    })).toThrow("TRUST_PROXY_HOPS must be an integer between 0 and 5");
  });

  it("rejects wildcard CORS in production", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db",
        JWT_ACCESS_SECRET: "a".repeat(32),
        JWT_REFRESH_SECRET: "b".repeat(32),
        BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
        CORS_ORIGINS: "*",
      }),
    ).toThrow("Wildcard CORS");
  });

  it("requires explicit HTTPS origins for production CORS", () => {
    const secureValues = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
      BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
      DOCUMENT_STORAGE_PROVIDER: "s3",
      DOCUMENT_STORAGE_S3_BUCKET: "gyami-global-private",
      DOCUMENT_STORAGE_S3_REGION: "ap-south-1",
      THROTTLE_REDIS_URL: "rediss://rate-limit.example:6380",
      METRICS_AUTH_TOKEN: "m".repeat(32),
    };
    expect(() =>
      validateEnvironment({ ...secureValues, CORS_ORIGINS: "http://marketplace.example" }),
    ).toThrow("Production CORS origins must use HTTPS");
    expect(() =>
      validateEnvironment({ ...secureValues, CORS_ORIGINS: "not an origin" }),
    ).toThrow("CORS_ORIGINS must contain valid web origins");
  });

  it("requires a valid distributed throttle store in production", () => {
    const values = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
      BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
      CORS_ORIGINS: "https://marketplace.example",
      DOCUMENT_STORAGE_PROVIDER: "s3",
      DOCUMENT_STORAGE_S3_BUCKET: "gyami-global-private",
      DOCUMENT_STORAGE_S3_REGION: "ap-south-1",
    };
    expect(() => validateEnvironment(values)).toThrow(
      "THROTTLE_REDIS_URL is required in production",
    );
    expect(() =>
      validateEnvironment({
        ...values,
        THROTTLE_REDIS_URL: "https://not-redis.example",
      }),
    ).toThrow("THROTTLE_REDIS_URL must be a redis or rediss URL");
  });

  it("requires an independent secret for production metrics scraping", () => {
    const values = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
      BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
      CORS_ORIGINS: "https://marketplace.example",
      DOCUMENT_STORAGE_PROVIDER: "s3",
      DOCUMENT_STORAGE_S3_BUCKET: "gyami-global-private",
      DOCUMENT_STORAGE_S3_REGION: "ap-south-1",
      THROTTLE_REDIS_URL: "rediss://rate-limit.example:6380",
    };
    expect(() => validateEnvironment(values)).toThrow(
      "METRICS_AUTH_TOKEN must contain at least 32 characters",
    );
    expect(
      validateEnvironment({ ...values, METRICS_AUTH_TOKEN: "m".repeat(32) })
        .METRICS_AUTH_TOKEN,
    ).toBe("m".repeat(32));
  });

  it("requires durable S3 document storage configuration in production", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db",
        JWT_ACCESS_SECRET: "a".repeat(32),
        JWT_REFRESH_SECRET: "b".repeat(32),
        BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
        CORS_ORIGINS: "https://marketplace.example",
      }),
    ).toThrow("S3 document storage requires");
  });

  it("requires a supported encryption policy for private S3 uploads", async () => {
    const values = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
      BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
      CORS_ORIGINS: "https://marketplace.example",
      DOCUMENT_STORAGE_PROVIDER: "s3",
      DOCUMENT_STORAGE_S3_BUCKET: "gyami-global-private",
      DOCUMENT_STORAGE_S3_REGION: "ap-south-1",
      THROTTLE_REDIS_URL: "rediss://rate-limit.example:6380",
      METRICS_AUTH_TOKEN: "m".repeat(32),
    };
    expect(
      validateEnvironment(values).DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION,
    ).toBe("AES256");
    expect(() =>
      validateEnvironment({
        ...values,
        DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION: "none",
      }),
    ).toThrow("DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION");
    expect(() =>
      validateEnvironment({
        ...values,
        DOCUMENT_STORAGE_S3_KMS_KEY_ID: "kms-key-id",
      }),
    ).toThrow("DOCUMENT_STORAGE_S3_KMS_KEY_ID requires");

    const storageValues: Record<string, string> = {
      DOCUMENT_STORAGE_PROVIDER: "s3",
      DOCUMENT_STORAGE_S3_BUCKET: "gyami-global-private",
      DOCUMENT_STORAGE_S3_REGION: "ap-south-1",
      DOCUMENT_STORAGE_S3_SERVER_SIDE_ENCRYPTION: "AES256",
    };
    const storage = new PrivateObjectStorageService({
      get: (key: string, fallback?: string) => storageValues[key] ?? fallback,
      getOrThrow: (key: string) => {
        const value = storageValues[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
      },
    } as unknown as ConfigService);
    const send = vi.fn().mockResolvedValue(undefined);
    (storage as unknown as { s3: { send: typeof send } }).s3 = { send };

    await storage.put("kyc/vendor/document.pdf", Buffer.from("document"), "application/pdf");

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          ServerSideEncryption: "AES256",
          SSEKMSKeyId: undefined,
        }),
      }),
    );
  });

  it("does not allow production to fall back to local private document storage", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://db",
        JWT_ACCESS_SECRET: "a".repeat(32),
        JWT_REFRESH_SECRET: "b".repeat(32),
        BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
        CORS_ORIGINS: "https://marketplace.example",
        DOCUMENT_STORAGE_PROVIDER: "local",
      }),
    ).toThrow("Production requires S3-compatible private document storage");
  });

  it("rejects simulated delivery and unsupported provider names in production", () => {
    const values = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://db",
      JWT_ACCESS_SECRET: "a".repeat(32),
      JWT_REFRESH_SECRET: "b".repeat(32),
      BANK_DATA_ENCRYPTION_KEY: "c".repeat(64),
      CORS_ORIGINS: "https://marketplace.example",
      DOCUMENT_STORAGE_PROVIDER: "s3",
      DOCUMENT_STORAGE_S3_BUCKET: "gyami-global-private",
      DOCUMENT_STORAGE_S3_REGION: "ap-south-1",
      THROTTLE_REDIS_URL: "rediss://rate-limit.example:6380",
      METRICS_AUTH_TOKEN: "m".repeat(32),
    };
    expect(() =>
      validateEnvironment({ ...values, SHIPPING_PROVIDER: "DEVELOPMENT" }),
    ).toThrow("shipping simulator is prohibited");
    expect(() =>
      validateEnvironment({ ...values, SHIPPING_PROVIDER: "other" }),
    ).toThrow("SHIPPING_PROVIDER must be DEVELOPMENT or SHIPROCKET");
    expect(() =>
      validateEnvironment({ ...values, WHATSAPP_PROVIDER: "DEVELOPMENT" }),
    ).toThrow("WhatsApp simulator is prohibited");
    expect(() =>
      validateEnvironment({ ...values, SMS_PROVIDER: "UNCONFIGURED" }),
    ).toThrow("SMS_PROVIDER must be MSG91 in production");
  });

  it("does not let a production shipping service fall back to simulation", async () => {
    const config = {
      get: (key: string, fallback?: string) =>
        ({ NODE_ENV: "production", SHIPPING_PROVIDER: "DEVELOPMENT" })[key] ?? fallback,
    } as unknown as ConfigService;
    const shipping = new ShippingService(
      config,
      {} as IntegrationSettingsService,
    );

    await expect(
      shipping.quote({
        originPincode: "411001",
        destinationPincode: "400001",
        weightGrams: 500,
        cod: false,
      }),
    ).rejects.toThrow("simulator is unavailable in production");
  });

  it("keeps development private documents inside their configured storage root", async () => {
    const root = await mkdtemp(join(tmpdir(), "gyami-global-private-"));
    const values: Record<string, string> = {
      DOCUMENT_STORAGE_PROVIDER: "local",
      PRIVATE_UPLOAD_DIR: root,
    };
    const config = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => {
        const value = values[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
      },
    } as unknown as ConfigService;
    const storage = new PrivateObjectStorageService(config);
    try {
      await storage.put("vendors/vendor-1/pan.pdf", Buffer.from("document"), "application/pdf");
      await expect(storage.get("vendors/vendor-1/pan.pdf")).resolves.toEqual(
        Buffer.from("document"),
      );
      await storage.remove("vendors/vendor-1/pan.pdf");
      await expect(storage.get("vendors/vendor-1/pan.pdf")).rejects.toThrow();
      await expect(
        storage.put("../outside.pdf", Buffer.from("unsafe"), "application/pdf"),
      ).rejects.toThrow("Invalid private storage key");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes a new private KYC object when its database write fails", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = new VendorDocumentsService(
      {
        vendorDocument: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockRejectedValue(new Error("database unavailable")),
        },
      } as unknown as PrismaService,
      {
        getByUser: vi.fn().mockResolvedValue({
          id: "vendor-id",
          status: VendorStatus.REGISTERED,
        }),
      } as unknown as VendorsService,
      { get: vi.fn().mockReturnValue(5_242_880) } as unknown as ConfigService,
      { put, remove } as unknown as PrivateObjectStorageService,
    );
    const file = {
      originalname: "pan.pdf",
      mimetype: "application/pdf",
      size: 8,
      buffer: Buffer.from("%PDF-1.7"),
    } as Express.Multer.File;

    await expect(
      service.upload("vendor-user", { type: VendorDocumentType.PAN }, file),
    ).rejects.toThrow("database unavailable");
    expect(put).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(
      expect.stringMatching(/^vendor-id\/[0-9a-f-]+\.pdf$/),
    );
  });

  it("removes complaint attachments when the complaint transaction cannot be saved", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = new ComplaintsService(
      {
        customerProfile: { findUnique: vi.fn().mockResolvedValue({ id: "customer-id" }) },
        complaint: { create: vi.fn().mockRejectedValue(new Error("database unavailable")) },
      } as unknown as PrismaService,
      {} as VendorsService,
      { get: vi.fn().mockReturnValue(5_242_880) } as unknown as ConfigService,
      {} as NotificationsService,
      { put, remove } as unknown as PrivateObjectStorageService,
    );
    const file = {
      originalname: "evidence.pdf",
      mimetype: "application/pdf",
      size: 8,
      buffer: Buffer.from("%PDF-1.7"),
    } as Express.Multer.File;

    await expect(
      service.create(
        "customer-user",
        {
          category: ComplaintCategory.PRODUCT,
          subject: "Damaged item",
          message: "The product arrived damaged.",
        } as any,
        [file],
      ),
    ).rejects.toThrow("database unavailable");
    expect(remove).toHaveBeenCalledWith(
      expect.stringMatching(/^complaints\/customer-id\/[0-9a-f-]+\.pdf$/),
    );
  });

  it("removes return evidence when the return transaction rolls back", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const service = new ReturnsService(
      {
        orderItem: {
          findFirst: vi.fn().mockResolvedValue({
            id: "item-id",
            status: "DELIVERED",
            vendorOrder: { deliveredAt: new Date() },
          }),
        },
        customerProfile: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "customer-id" }) },
        $transaction: vi.fn().mockRejectedValue(new Error("transaction failed")),
      } as unknown as PrismaService,
      {
        get: vi.fn((key: string, fallback?: number) =>
          key === "MAX_UPLOAD_BYTES" ? 5_242_880 : (fallback ?? 7),
        ),
      } as unknown as ConfigService,
      {} as VendorsService,
      {} as NotificationsService,
      { put, remove } as unknown as PrivateObjectStorageService,
    );
    const file = {
      originalname: "return-evidence.pdf",
      mimetype: "application/pdf",
      size: 8,
      buffer: Buffer.from("%PDF-1.7"),
    } as Express.Multer.File;

    await expect(
      service.create(
        "customer-user",
        "order-id",
        "item-id",
        { reason: "Damaged", resolution: "REFUND" } as any,
        [file],
      ),
    ).rejects.toThrow("transaction failed");
    expect(remove).toHaveBeenCalledWith(
      expect.stringMatching(/^returns\/customer-id\/[0-9a-f-]+\.pdf$/),
    );
  });
});

describe("approval gates", () => {
  it("surfaces failed and in-progress provider recovery queues on the admin dashboard", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const providerEventCount = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    const service = new AdminService(
      {
        $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
        customerProfile: { count },
        vendor: { count },
        product: { count },
        masterOrder: {
          count,
          aggregate: vi.fn().mockResolvedValue({ _sum: { payableTotal: 0 } }),
        },
        vendorOrder: { count },
        commissionTransaction: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        },
        settlement: {
          aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        },
        refund: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
        complaint: { count },
        review: { count },
        inventory: { count },
        providerEvent: { count: providerEventCount },
      } as unknown as PrismaService,
      {} as VendorsService,
      {} as NotificationsService,
    );

    await expect(service.dashboard()).resolves.toMatchObject({
      failedProviderEvents: 3,
      processingProviderEvents: 1,
    });
    expect(providerEventCount).toHaveBeenNthCalledWith(1, {
      where: { processedAt: null, failureReason: { not: null } },
    });
    expect(providerEventCount).toHaveBeenNthCalledWith(2, {
      where: { processedAt: null, processingAt: { not: null } },
    });
  });

  it("records an audit event when an administrator retries a failed WhatsApp notification", async () => {
    const retryFailedWhatsApp = vi.fn().mockResolvedValue({
      id: "notification",
      channel: "WHATSAPP",
      status: NotificationStatus.SENT,
      providerReference: "provider-reference",
      failureReason: null,
    });
    const auditCreate = vi.fn().mockResolvedValue({ id: "audit" });
    const service = new AdminService(
      {
        notification: {
          findUnique: vi.fn().mockResolvedValue({
            status: NotificationStatus.FAILED,
            channel: "WHATSAPP",
            failureReason: "Temporary provider error",
          }),
        },
        auditLog: { create: auditCreate },
      } as unknown as PrismaService,
      {} as VendorsService,
      { retryFailedWhatsApp } as unknown as NotificationsService,
    );

    await expect(service.retryNotification("notification", "admin")).resolves.toMatchObject({
      status: NotificationStatus.SENT,
    });
    expect(retryFailedWhatsApp).toHaveBeenCalledWith("notification");
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorId: "admin",
        action: "NOTIFICATION_RETRIED",
        entityType: "Notification",
        entityId: "notification",
      }) as object,
    }));
  });

  it("only permits an administrator to retry a failed provider event and audits it", async () => {
    const retryFailedWebhookEvent = vi.fn().mockResolvedValue({
      accepted: true,
      retried: true,
    });
    const auditCreate = vi.fn().mockResolvedValue({ id: "audit" });
    const service = new AdminService(
      {
        providerEvent: {
          findUnique: vi.fn().mockResolvedValue({
            id: "provider-event",
            provider: "RAZORPAY",
            eventId: "event-id",
            eventType: "payment.captured",
            processedAt: null,
            processingAt: null,
            processingAttempts: 1,
            failureReason: "Temporary provider failure",
          }),
        },
        auditLog: { create: auditCreate },
      } as unknown as PrismaService,
      {} as VendorsService,
      {} as NotificationsService,
      { retryFailedWebhookEvent } as unknown as import("../src/payments/payments.service").PaymentsService,
    );

    await expect(service.retryProviderEvent("provider-event", "admin")).resolves.toEqual({
      accepted: true,
      retried: true,
    });
    expect(retryFailedWebhookEvent).toHaveBeenCalledWith("provider-event");
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "PROVIDER_EVENT_RETRIED" }) as object,
    }));
  });

  it("permits an administrator to recover a provider event with an expired lease", async () => {
    const retryFailedWebhookEvent = vi.fn().mockResolvedValue({
      accepted: true,
      retried: true,
    });
    const service = new AdminService(
      {
        providerEvent: {
          findUnique: vi.fn().mockResolvedValue({
            id: "stale-provider-event",
            provider: "RAZORPAY",
            eventId: "event-id",
            eventType: "payment.captured",
            processedAt: null,
            processingAt: new Date(Date.now() - 6 * 60_000),
            processingAttempts: 1,
            failureReason: null,
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
      } as unknown as PrismaService,
      {} as VendorsService,
      {} as NotificationsService,
      { retryFailedWebhookEvent } as unknown as import("../src/payments/payments.service").PaymentsService,
    );

    await expect(service.retryProviderEvent("stale-provider-event", "admin")).resolves.toEqual({
      accepted: true,
      retried: true,
    });
    expect(retryFailedWebhookEvent).toHaveBeenCalledWith("stale-provider-event");
  });

  it("requires a normalized upload before a vendor can submit a product", async () => {
    const update = vi.fn();
    const count = vi.fn().mockResolvedValue(0);
    const service = new ProductsService(
      {
        product: {
          findFirst: vi.fn().mockResolvedValue({
            id: "draft-product",
            vendorId: "vendor-1",
            status: ProductStatus.DRAFT,
            images: [{ url: "https://untrusted.example/product.jpg" }],
          }),
          update,
        },
        productImage: { count },
      } as unknown as PrismaService,
      { getVendorId: vi.fn().mockResolvedValue("vendor-1") } as unknown as VendorsService,
      {} as ProductImageStorageService,
      {} as NotificationsService,
    );

    await expect(service.submit("vendor-user", "draft-product")).rejects.toThrow(
      "Upload at least one optimized product photo",
    );
    expect(count).toHaveBeenCalledWith({
      where: {
        productId: "draft-product",
        imageData: { not: null },
        mimeType: "image/webp",
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("uses slug-only predicates for public catalogue identifiers that are not UUIDs", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ProductsService(
      {
        product: { findMany, count, findFirst },
        $transaction: vi.fn((operations: unknown[]) => Promise.all(operations)),
      } as unknown as PrismaService,
      {} as VendorsService,
      {} as ProductImageStorageService,
      {} as NotificationsService,
    );

    await service.publicList({
      page: 1,
      limit: 20,
      category: "millets",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: { slug: "millets" } }),
      }),
    );

    await expect(service.publicGet("not-a-real-product")).rejects.toThrow(
      "Product not found",
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ slug: "not-a-real-product" }] }),
      }),
    );
  });

  it("notifies the vendor when an administrator approves a submitted product", async () => {
    const createInApp = vi.fn().mockResolvedValue({ id: "notification" });
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product",
          name: "Village Millet Mix",
          status: ProductStatus.PENDING_APPROVAL,
          vendor: { status: VendorStatus.APPROVED, userId: "vendor-user" },
        }),
        update: vi.fn().mockResolvedValue({
          id: "product",
          status: ProductStatus.APPROVED,
          updatedAt: new Date("2026-10-07T00:00:00.000Z"),
        }),
      },
      productImage: { count: vi.fn().mockResolvedValue(1) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as VendorsService,
      { createInApp } as unknown as NotificationsService,
    );

    await service.approveProduct("product", "admin");

    expect(createInApp).toHaveBeenCalledWith(
      "vendor-user",
      "PRODUCT_APPROVED",
      expect.objectContaining({
        productId: "product",
        status: ProductStatus.APPROVED,
      }) as object,
      "product-approved:product:2026-10-07T00:00:00.000Z",
    );
  });

  it("notifies the vendor and preserves the reason when a submitted product is rejected", async () => {
    const createInApp = vi.fn().mockResolvedValue({ id: "notification" });
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product",
          name: "Village Millet Mix",
          status: ProductStatus.PENDING_APPROVAL,
          vendor: { userId: "vendor-user" },
        }),
        update: vi.fn().mockResolvedValue({
          id: "product",
          status: ProductStatus.REJECTED,
          updatedAt: new Date("2026-10-07T00:00:00.000Z"),
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as VendorsService,
      { createInApp } as unknown as NotificationsService,
    );

    await service.rejectProduct("product", "admin", "Add a clearer label photo");

    expect(createInApp).toHaveBeenCalledWith(
      "vendor-user",
      "PRODUCT_REJECTED",
      expect.objectContaining({
        reason: "Add a clearer label photo",
        status: ProductStatus.REJECTED,
      }) as object,
      "product-rejected:product:2026-10-07T00:00:00.000Z",
    );
  });

  it("allows an approved product to be returned for a corrected vendor submission", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "product",
      status: ProductStatus.REJECTED,
      updatedAt: new Date("2026-10-07T00:00:00.000Z"),
    });
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product",
          name: "Village Millet Mix",
          status: ProductStatus.APPROVED,
          vendor: { userId: "vendor-user" },
        }),
        update,
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as VendorsService,
      { createInApp: vi.fn().mockResolvedValue({ id: "notification" }) } as unknown as NotificationsService,
    );

    await expect(
      service.rejectProduct("product", "admin", "Replace the product photo"),
    ).resolves.toMatchObject({ status: ProductStatus.REJECTED });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: ProductStatus.REJECTED,
          rejectionReason: "Replace the product photo",
        },
      }),
    );
  });

  it("does not approve a product owned by an unapproved vendor", async () => {
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product",
          status: ProductStatus.PENDING_APPROVAL,
          vendor: { status: VendorStatus.PENDING },
        }),
      },
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as VendorsService,
      {} as NotificationsService,
    );
    await expect(service.approveProduct("product", "admin")).rejects.toThrow(
      "Vendor must be approved",
    );
  });

  it("does not approve a product without an optimized stored image", async () => {
    const update = vi.fn();
    const prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue({
          id: "product",
          status: ProductStatus.PENDING_APPROVAL,
          vendor: { status: VendorStatus.APPROVED, userId: "vendor-user" },
        }),
        update,
      },
      productImage: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as VendorsService,
      {} as NotificationsService,
    );

    await expect(service.approveProduct("product", "admin")).rejects.toThrow(
      "Product needs at least one optimized photo",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("does not reject an already approved vendor", async () => {
    const prisma = {
      vendor: {
        findUnique: vi.fn().mockResolvedValue({
          id: "vendor",
          status: VendorStatus.APPROVED,
        }),
      },
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as VendorsService,
      {} as NotificationsService,
    );
    await expect(
      service.rejectVendor("vendor", "admin", "Invalid transition"),
    ).rejects.toThrow("must be suspended, not rejected");
  });

  it("does not suspend a vendor before approval", async () => {
    const prisma = {
      vendor: {
        findUnique: vi.fn().mockResolvedValue({
          id: "vendor",
          status: VendorStatus.PENDING,
        }),
      },
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as VendorsService,
      {} as NotificationsService,
    );
    await expect(
      service.suspendVendor(
        "vendor",
        "admin",
        VendorSuspensionReason.OTHER,
      ),
    ).rejects.toThrow("Only an approved vendor can be suspended");
  });

  it("requires every physical inspection check before passing", async () => {
    const prisma = {
      vendorInspection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "inspection",
          vendorId: "vendor",
          status: InspectionStatus.IN_PROGRESS,
        }),
      },
    } as unknown as PrismaService;
    const service = new VendorInspectionsService(
      prisma,
      {} as VendorsService,
    );
    await expect(
      service.update("inspection", "admin", {
        status: InspectionStatus.PASSED,
        checklist: { businessActivityVerified: true },
        documentsVerified: true,
        premisesVerified: true,
        qualityVerified: false,
      }),
    ).rejects.toThrow("must all be verified");
  });

  it("requires business activity verification before passing", async () => {
    const prisma = {
      vendorInspection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "inspection",
          vendorId: "vendor",
          status: InspectionStatus.IN_PROGRESS,
        }),
      },
    } as unknown as PrismaService;
    const service = new VendorInspectionsService(
      prisma,
      {} as VendorsService,
    );
    await expect(
      service.update("inspection", "admin", {
        status: InspectionStatus.PASSED,
        checklist: { businessActivityVerified: false },
        documentsVerified: true,
        premisesVerified: true,
        qualityVerified: true,
      }),
    ).rejects.toThrow("Business activity must be verified");
  });

  it("allows an administrator to schedule a verified registered vendor", async () => {
    const create = vi.fn().mockResolvedValue({ id: "inspection" });
    const transition = vi.fn().mockResolvedValue({ status: VendorStatus.INSPECTION });
    const prisma = {
      vendor: {
        findUnique: vi.fn().mockResolvedValue({ status: VendorStatus.REGISTERED }),
      },
      vendorInspection: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    } as unknown as PrismaService;
    const vendors = {
      assertKycVerified: vi.fn().mockResolvedValue(undefined),
      transition,
    } as unknown as VendorsService;
    const service = new VendorInspectionsService(prisma, vendors);
    await service.create("vendor", "admin", {
      scheduledAt: "2026-09-21T10:00:00.000Z",
      location: "Vendor premises",
      checklist: {},
    });
    expect(create).toHaveBeenCalledOnce();
    expect(transition).toHaveBeenCalledWith(
      "vendor",
      "admin",
      VendorStatus.INSPECTION,
      "Physical inspection scheduled",
    );
  });

  it("requires a reason when an inspection fails or needs review", async () => {
    const prisma = {
      vendorInspection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "inspection",
          vendorId: "vendor",
          status: InspectionStatus.IN_PROGRESS,
        }),
      },
    } as unknown as PrismaService;
    const service = new VendorInspectionsService(
      prisma,
      {} as VendorsService,
    );
    await expect(
      service.update("inspection", "admin", {
        status: InspectionStatus.NEEDS_REVIEW,
        documentsVerified: true,
        premisesVerified: false,
        qualityVerified: true,
      }),
    ).rejects.toThrow("A reason is required");
  });

  it("persists a rescheduled inspection through the existing update flow", async () => {
    const update = vi.fn().mockResolvedValue({ id: "inspection" });
    const auditCreate = vi.fn().mockResolvedValue({ id: "audit" });
    const prisma = {
      vendorInspection: {
        findUnique: vi.fn().mockResolvedValue({
          id: "inspection",
          vendorId: "vendor",
          status: InspectionStatus.SCHEDULED,
          scheduledAt: new Date("2026-09-20T10:00:00.000Z"),
          location: "Old location",
        }),
        update,
      },
      auditLog: { create: auditCreate },
    } as unknown as PrismaService;
    const service = new VendorInspectionsService(
      prisma,
      {} as VendorsService,
    );
    await service.update("inspection", "admin", {
      status: InspectionStatus.SCHEDULED,
      scheduledAt: "2026-09-21T10:00:00.000Z",
      location: "New location",
      documentsVerified: false,
      premisesVerified: false,
      qualityVerified: false,
    });
    expect(update).toHaveBeenCalledOnce();
    const [updateInput] = update.mock.calls[0] as unknown as [
      { data: { scheduledAt: Date; location: string } },
    ];
    expect(updateInput.data.scheduledAt).toEqual(
      new Date("2026-09-21T10:00:00.000Z"),
    );
    expect(updateInput.data.location).toBe("New location");
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});

describe("vendor ownership", () => {
  it("does not return an order belonging to another vendor", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      vendorOrder: { findFirst },
    } as unknown as PrismaService;
    const vendors = {
      getVendorId: vi.fn().mockResolvedValue("vendor-a"),
    } as unknown as VendorsService;
    const service = new OrdersService(
      prisma,
      vendors,
      {} as ConfigService,
      {} as NotificationsService,
    );
    await expect(service.vendorGet("user-a", "vendor-b-order")).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "vendor-b-order", vendorId: "vendor-a" },
      }),
    );
  });
});
