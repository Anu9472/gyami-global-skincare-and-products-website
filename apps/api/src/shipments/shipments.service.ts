import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OrderStatus, Prisma, Role, ShipmentStatus } from "@prisma/client";
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestUser } from "../common/request-user";
import { PrismaService } from "../database/prisma.service";
import { IntegrationSettingsService } from "../integration-settings/integration-settings.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  canRetryProviderEvent,
  claimProviderEvent,
  failProviderEvent,
} from "../common/provider-events";
import {
  DevelopmentShippingProvider,
  type ShipmentCreateInput,
  ShiprocketShippingProvider,
  type ShippingProvider,
  type ShippingRate,
  type ShippingRateInput,
} from "./shipping-provider";

const terminalShipmentStatuses = new Set<ShipmentStatus>([
  ShipmentStatus.DELIVERED,
  ShipmentStatus.FAILED,
  ShipmentStatus.CANCELLED,
  ShipmentStatus.RETURNED,
]);

const shipmentStatusRank: Partial<Record<ShipmentStatus, number>> = {
  [ShipmentStatus.PENDING]: 0,
  [ShipmentStatus.READY_TO_SHIP]: 1,
  [ShipmentStatus.PICKED_UP]: 2,
  [ShipmentStatus.IN_TRANSIT]: 3,
  [ShipmentStatus.OUT_FOR_DELIVERY]: 4,
};

/**
 * Providers may replay or deliver scans out of order. Terminal outcomes must
 * never be overwritten, and an earlier scan must not regress customer-facing
 * tracking. Exception/terminal statuses can be reached from any active state.
 */
export function canApplyShipmentStatus(
  current: ShipmentStatus,
  next: ShipmentStatus,
): boolean {
  if (current === next || terminalShipmentStatuses.has(current)) return false;
  if (terminalShipmentStatuses.has(next)) return true;
  return (shipmentStatusRank[next] ?? -1) > (shipmentStatusRank[current] ?? -1);
}

@Injectable()
export class ShippingService {
  private readonly development: ShippingProvider;
  private readonly shiprocket: ShippingProvider;
  private readonly production: boolean;
  private readonly configuredProvider: "DEVELOPMENT" | "SHIPROCKET";
  constructor(
    private readonly config: ConfigService,
    settings: IntegrationSettingsService,
  ) {
    this.development = new DevelopmentShippingProvider(this.config);
    this.shiprocket = new ShiprocketShippingProvider(settings);
    this.production = this.config.get<string>("NODE_ENV", "development") === "production";
    this.configuredProvider = this.config.get<"DEVELOPMENT" | "SHIPROCKET">(
      "SHIPPING_PROVIDER",
      this.production ? "SHIPROCKET" : "DEVELOPMENT",
    );
  }
  private provider(): ShippingProvider {
    if (this.configuredProvider === "SHIPROCKET") return this.shiprocket;
    if (!this.production && this.configuredProvider === "DEVELOPMENT") {
      return this.development;
    }
    throw new BadRequestException(
      "The development shipping simulator is unavailable in production",
    );
  }
  async quote(input: ShippingRateInput): Promise<ShippingRate> {
    return this.provider().quote(input);
  }
  async createShipment(input: ShipmentCreateInput) {
    return this.provider().createShipment(input);
  }
  async createReturnShipment(input: ShipmentCreateInput) {
    return this.provider().createReturnShipment(input);
  }
}

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipping: ShippingService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly integrationSettings: IntegrationSettingsService,
  ) {}
  async tracking(user: RequestUser, id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        vendorOrder: {
          include: {
            vendor: { select: { userId: true } },
            masterOrder: {
              include: { customer: { select: { userId: true } } },
            },
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException("Shipment not found");
    const allowed =
      user.role === Role.ADMIN ||
      (user.role === Role.VENDOR &&
        shipment.vendorOrder.vendor.userId === user.id) ||
      (user.role === Role.CUSTOMER &&
        shipment.vendorOrder.masterOrder.customer.userId === user.id);
    if (!allowed) throw new NotFoundException("Shipment not found");
    return this.presentTracking(shipment);
  }
  async createForVendorOrder(userId: string, vendorOrderId: string) {
    const order = await this.prisma.vendorOrder.findFirst({
      where: { id: vendorOrderId, vendor: { userId } },
      include: {
        vendor: true,
        masterOrder: true,
        items: { include: { product: true } },
        shipment: true,
      },
    });
    if (!order) throw new NotFoundException("Vendor order not found");
    if (order.shipment) return order.shipment;
    const address = order.masterOrder
      .deliveryAddressSnapshot as Prisma.JsonObject;
    const requiredAddress = (key: string): string => {
      const value = address[key];
      if (typeof value !== "string" || !value)
        throw new BadRequestException(`Delivery address ${key} is invalid`);
      return value;
    };
    const line2 = address.line2;
    const input: ShipmentCreateInput = {
      idempotencyKey: `shipment:${order.id}`,
      vendorOrderNumber: order.vendorOrderNumber,
      originPincode: order.vendor.pickupPincode ?? "",
      destination: {
        name: requiredAddress("recipientName"),
        mobile: requiredAddress("mobile"),
        line1: requiredAddress("line1"),
        ...(typeof line2 === "string" && line2 ? { line2 } : {}),
        city: requiredAddress("city"),
        state: requiredAddress("state"),
        pincode: requiredAddress("pincode"),
      },
      weightGrams: order.items.reduce(
        (sum, item) => sum + item.product.weightGrams * item.quantity,
        0,
      ),
      amountMinor: Math.round(order.orderTotal.toNumber() * 100),
      cod: order.masterOrder.paymentMethod === "COD",
      items: order.items.map((item) => ({
        name: item.productName,
        sku: item.sku ?? item.productId,
        quantity: item.quantity,
        unitPriceMinor: Math.round(item.unitPrice.toNumber() * 100),
      })),
    };
    const result = await this.shipping.createShipment(input);
    let shipment;
    try {
      shipment = await this.prisma.shipment.create({
        data: {
          vendorOrderId: order.id,
          provider: result.provider,
          idempotencyKey: input.idempotencyKey,
          providerShipmentId: result.providerShipmentId,
          awb: result.awb,
          trackingUrl: result.trackingUrl,
          status: ShipmentStatus.PENDING,
          statusHistory: [
            {
              status: ShipmentStatus.PENDING,
              occurredAt: new Date().toISOString(),
              development: result.development,
            },
          ],
        },
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      // A concurrent request can reach the carrier before either request has
      // written its local row. The carrier receives the same idempotency key;
      // return the winner's record rather than exposing a spurious conflict.
      const existing = await this.prisma.shipment.findUnique({
        where: { vendorOrderId: order.id },
      });
      if (!existing) throw error;
      return existing;
    }
    await this.notifications
      .notifyShipmentStatus(order.id, shipment.status, {
        awb: shipment.awb,
        trackingUrl: shipment.trackingUrl,
      })
      .catch(() => undefined);
    return shipment;
  }

  async shiprocketWebhook(rawBody: Buffer, suppliedSecret?: string) {
    const expectedSecret = await this.integrationSettings.get("SHIPROCKET_WEBHOOK_SECRET");
    if (
      !expectedSecret ||
      !suppliedSecret ||
      !this.safeEqual(expectedSecret, suppliedSecret)
    ) {
      throw new UnauthorizedException("Invalid shipping webhook secret");
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new BadRequestException("Invalid shipping webhook payload");
    }
    const eventId = createHash("sha256").update(rawBody).digest("hex");
    const eventType = this.webhookString(payload, [
      "current_status",
      "shipment_status",
      "status",
    ]);
    const eventKey = { provider: "SHIPROCKET", eventId };
    const claim = await claimProviderEvent(this.prisma, {
      ...eventKey,
      eventType,
      payload: payload as Prisma.InputJsonValue,
    });
    if (!claim.claimed) return { accepted: true, duplicate: claim.duplicate };
    return this.processShiprocketWebhook(payload, eventId, eventType);
  }

  async retryFailedWebhookEvent(providerEventId: string) {
    const event = await this.prisma.providerEvent.findUnique({
      where: { id: providerEventId },
    });
    if (!event || event.provider !== "SHIPROCKET") {
      throw new NotFoundException("Shiprocket provider event not found");
    }
    if (!canRetryProviderEvent(event)) {
      throw new BadRequestException("Only failed or stale provider events can be retried");
    }
    if (!isWebhookPayload(event.payload)) {
      throw new BadRequestException("Stored provider event is invalid");
    }
    const claim = await claimProviderEvent(this.prisma, {
      provider: event.provider,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.payload,
    });
    if (!claim.claimed) {
      throw new ConflictException("This provider event is already being processed");
    }
    return this.processShiprocketWebhook(event.payload, event.eventId, event.eventType);
  }

  private async processShiprocketWebhook(
    payload: Record<string, unknown>,
    eventId: string,
    eventType: string,
  ) {
    const eventKey = { provider: "SHIPROCKET", eventId };
    try {
      const providerShipmentId = this.webhookString(
        payload,
        ["shipment_id"],
        false,
      );
      const awb = this.webhookString(payload, ["awb", "awb_code"], false);
      const location = this.webhookString(
        payload,
        ["current_location", "location", "scan_location"],
        false,
      );
      if (!providerShipmentId && !awb) {
        throw new BadRequestException("Shipping reference is missing");
      }
      const shipment = await this.prisma.shipment.findFirst({
        where: {
          OR: [
            ...(providerShipmentId ? [{ providerShipmentId }] : []),
            ...(awb ? [{ awb }] : []),
          ],
        },
      });
      if (!shipment) throw new NotFoundException("Shipment not found");
      const status = this.mapShiprocketStatus(eventType);
      const history = Array.isArray(shipment.statusHistory)
        ? shipment.statusHistory
        : [];
      const now = new Date();
      const applyStatus = canApplyShipmentStatus(shipment.status, status);
      await this.prisma.$transaction(async (tx) => {
        if (applyStatus) {
          await tx.shipment.update({
            where: { id: shipment.id },
            data: {
              status,
              ...(awb ? { awb } : {}),
              statusHistory: [
                ...history,
                {
                  status,
                  providerStatus: eventType,
                  ...(location ? { location } : {}),
                  occurredAt: now.toISOString(),
                },
              ] as Prisma.InputJsonValue,
              ...(status === ShipmentStatus.PICKED_UP ? { shippedAt: now } : {}),
              ...(status === ShipmentStatus.DELIVERED
                ? { deliveredAt: now }
                : {}),
            },
          });
        }
        if (applyStatus && status === ShipmentStatus.DELIVERED) {
          const settlementEligibleAt = new Date(
            now.getTime() +
              this.config.get<number>("SETTLEMENT_DAYS", 7) * 86_400_000,
          );
          const vendorOrder = await tx.vendorOrder.update({
            where: { id: shipment.vendorOrderId },
            data: {
              status: OrderStatus.DELIVERED,
              deliveredAt: now,
              settlementEligibleAt,
            },
          });
          await tx.orderItem.updateMany({
            where: {
              vendorOrderId: shipment.vendorOrderId,
              status: { not: OrderStatus.CANCELLED },
            },
            data: { status: OrderStatus.DELIVERED, cancellable: false },
          });
          const vendorOrders = await tx.vendorOrder.findMany({
            where: { masterOrderId: vendorOrder.masterOrderId },
            select: { status: true },
          });
          if (
            vendorOrders.every(
              (candidate) => candidate.status === OrderStatus.DELIVERED,
            )
          ) {
            await tx.masterOrder.update({
              where: { id: vendorOrder.masterOrderId },
              data: { status: OrderStatus.DELIVERED },
            });
          }
        }
        await tx.providerEvent.update({
          where: { provider_eventId: eventKey },
          data: { processedAt: now, processingAt: null, failureReason: null },
        });
      });
      if (applyStatus) {
        await this.notifications
          .notifyShipmentStatus(shipment.vendorOrderId, status, {
            awb: awb || shipment.awb,
            trackingUrl: shipment.trackingUrl,
          })
          .catch(() => undefined);
      }
      return { accepted: true, duplicate: false };
    } catch (error) {
      await failProviderEvent(
        this.prisma,
        "SHIPROCKET",
        eventId,
        error instanceof Error ? error.message : "Webhook processing failed",
      );
      throw error;
    }
  }

  private webhookString(
    payload: Record<string, unknown>,
    keys: string[],
    required = true,
  ): string {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value) return value;
      if (typeof value === "number") return String(value);
    }
    if (required) throw new BadRequestException(`${keys[0]} is missing`);
    return "";
  }

  private mapShiprocketStatus(status: string): ShipmentStatus {
    const normalized = status.toUpperCase().replaceAll(" ", "_");
    if (normalized.includes("DELIVERED")) return ShipmentStatus.DELIVERED;
    if (normalized.includes("OUT_FOR_DELIVERY")) {
      return ShipmentStatus.OUT_FOR_DELIVERY;
    }
    if (normalized.includes("IN_TRANSIT")) return ShipmentStatus.IN_TRANSIT;
    if (normalized.includes("PICKED")) return ShipmentStatus.PICKED_UP;
    if (normalized.includes("READY") || normalized.includes("MANIFEST")) {
      return ShipmentStatus.READY_TO_SHIP;
    }
    if (normalized.includes("RETURN")) return ShipmentStatus.RETURNED;
    if (normalized.includes("CANCEL")) return ShipmentStatus.CANCELLED;
    if (normalized.includes("FAIL") || normalized.includes("LOST")) {
      return ShipmentStatus.FAILED;
    }
    return ShipmentStatus.PENDING;
  }

  private safeEqual(expected: string, supplied: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    return (
      expectedBuffer.length === suppliedBuffer.length &&
      timingSafeEqual(expectedBuffer, suppliedBuffer)
    );
  }

  private presentTracking(shipment: {
    id: string;
    provider: string;
    awb: string | null;
    trackingUrl: string | null;
    status: ShipmentStatus;
    statusHistory: Prisma.JsonValue;
    estimatedDelivery: Date | null;
    updatedAt: Date;
  }) {
    const status =
      shipment.status === ShipmentStatus.FAILED ||
      shipment.status === ShipmentStatus.RETURNED
        ? "EXCEPTION"
        : shipment.status;
    const history = Array.isArray(shipment.statusHistory)
      ? shipment.statusHistory
      : [];
    return {
      id: shipment.id,
      provider: shipment.provider,
      awb: shipment.awb ?? undefined,
      trackingUrl: shipment.trackingUrl ?? undefined,
      status,
      statusLabel: status.replaceAll("_", " "),
      updatedAt: shipment.updatedAt.toISOString(),
      estimatedDelivery: shipment.estimatedDelivery?.toISOString(),
      events: history.flatMap((event, index) => {
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          return [];
        }
        const value = event;
        return [
          {
            id: `${shipment.id}:${index}`,
            status: typeof value.status === "string" ? value.status : status,
            label:
              typeof value.providerStatus === "string"
                ? value.providerStatus
                : status.replaceAll("_", " "),
            ...(typeof value.location === "string" && value.location
              ? { location: value.location }
              : {}),
            occurredAt:
              typeof value.occurredAt === "string"
                ? value.occurredAt
                : shipment.updatedAt.toISOString(),
          },
        ];
      }),
    };
  }
}

function isWebhookPayload(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
