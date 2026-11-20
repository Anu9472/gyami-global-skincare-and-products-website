import { Controller, Get, Inject, Optional, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./database/prisma.service";
import { PrivateObjectStorageService } from "./storage/private-object-storage.service";
import { ApplicationLifecycleService } from "./common/application-lifecycle.service";
import { IntegrationSettingsService } from "./integration-settings/integration-settings.service";

// The configured default Redis connection is registered by @nestjs-redis/client
// under this documented token. Keep the health boundary package-neutral so the
// unit-test runner does not need to evaluate its ESM-only export map.
const RATE_LIMIT_STORE_TOKEN = "REDIS_CLIENT";

interface RateLimitStore {
  ping(): Promise<string>;
}

const launchRequiredIntegrationSettings = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "SHIPROCKET_EMAIL",
  "SHIPROCKET_PASSWORD",
  "SHIPROCKET_WEBHOOK_SECRET",
  "INTERAKT_API_KEY",
  "MSG91_AUTH_KEY",
  "MSG91_WIDGET_ID",
  "MSG91_WIDGET_TOKEN",
] as const;

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentStorage: PrivateObjectStorageService,
    private readonly lifecycle: ApplicationLifecycleService,
    @Optional()
    @Inject(RATE_LIMIT_STORE_TOKEN)
    private readonly rateLimitStore?: RateLimitStore,
    @Optional()
    private readonly integrationSettings?: IntegrationSettingsService,
  ) {}

  @Get()
  async readiness(): Promise<{
    status: "ok";
    database: "connected";
    rateLimitStore: "connected" | "not-configured";
    documentStorage: "connected";
  }> {
    if (this.lifecycle.isDraining()) {
      throw new ServiceUnavailableException("Application is shutting down");
    }
    await this.prisma.$queryRaw`SELECT 1`;
    try {
      await this.documentStorage.readiness();
    } catch {
      throw new ServiceUnavailableException("Document storage is unavailable");
    }
    if (!this.rateLimitStore) {
      return {
        status: "ok",
        database: "connected",
        rateLimitStore: "not-configured",
        documentStorage: "connected",
      };
    }
    const response = await this.rateLimitStore.ping();
    if (response !== "PONG") {
      throw new ServiceUnavailableException("Rate limit store is unavailable");
    }
    return {
      status: "ok",
      database: "connected",
      rateLimitStore: "connected",
      documentStorage: "connected",
    };
  }

  @Get("live")
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<{
    status: "ok";
    database: "connected";
    rateLimitStore: "connected" | "not-configured";
    documentStorage: "connected";
  }> {
    return this.readiness();
  }

  /**
   * A stricter, deployment-only readiness gate. Normal readiness intentionally
   * remains available while an administrator is completing initial setup; this
   * endpoint prevents a production cutover before the marketplace's required
   * external integrations have been configured.
   */
  @Get("launch")
  async launchReadiness(): Promise<{ status: "ok" | "not-required" }> {
    if (process.env.NODE_ENV !== "production") {
      return { status: "not-required" };
    }

    await this.readiness();
    if (!this.integrationSettings) {
      throw new ServiceUnavailableException("Launch integrations are unavailable");
    }
    const configured = await Promise.all(
      launchRequiredIntegrationSettings.map((key) => this.integrationSettings!.has(key)),
    );
    if (configured.some((value) => !value)) {
      throw new ServiceUnavailableException("Launch integrations are not configured");
    }
    return { status: "ok" };
  }
}
