import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { IntegrationSettingsService } from "../integration-settings/integration-settings.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  canRetryProviderEvent,
  claimProviderEvent,
  completeProviderEvent,
  failProviderEvent,
} from "../common/provider-events";
import {
  finalizeMasterOrder,
  releaseOrderItemInventory,
} from "../inventory/reservation-engine";
import { completeRefundFinancials } from "../refunds/refund-engine";
import {
  RazorpayPaymentProvider,
  verifyRazorpaySignature,
} from "./payment-provider";
import type { VerifyPaymentDto } from "./payments.dto";

type WebhookEntity = Record<string, unknown>;

const paymentStatusesAwaitingCapture = new Set<PaymentStatus>([
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.AUTHORIZED,
]);

const paymentSessionStatuses = [
  PaymentStatus.CREATED,
  PaymentStatus.PENDING,
  PaymentStatus.AUTHORIZED,
  PaymentStatus.PAID,
];

/** A terminal finance state must be reconciled by an administrator, not revived by a late webhook. */
export function canConfirmPaymentStatus(status: PaymentStatus): boolean {
  return paymentStatusesAwaitingCapture.has(status);
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: RazorpayPaymentProvider,
    private readonly notifications: NotificationsService,
    private readonly integrationSettings: IntegrationSettingsService,
  ) {}

  async create(userId: string, masterOrderId: string) {
    const order = await this.prisma.masterOrder.findFirst({
      where: { id: masterOrderId, customer: { userId } },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (order.paymentMethod !== "PREPAID") {
      throw new BadRequestException(
        "Payment session is only available for prepaid orders",
      );
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        "Payment session is only available while the order is awaiting payment",
      );
    }
    let payment = await this.openPayment(masterOrderId);
    if (payment?.providerOrderId) {
      return this.session(
        payment.id,
        order.id,
        payment.providerOrderId,
        payment.amount.toNumber(),
        order.orderNumber,
      );
    }

    const amountMinor = Math.round(order.payableTotal.toNumber() * 100);
    if (!payment) {
      try {
        payment = await this.prisma.payment.create({
          data: {
            masterOrderId,
            provider: "RAZORPAY",
            method: "PREPAID",
            amount: order.payableTotal,
            currency: order.currency,
            status: PaymentStatus.CREATED,
            idempotencyKey: `payment:${masterOrderId}`,
          },
        });
      } catch (error) {
        // A concurrent request can win the unique idempotency-key insert. It
        // must never result in a second provider order for the same checkout.
        if (!isUniqueConstraintError(error)) throw error;
        payment = await this.openPayment(masterOrderId);
        if (!payment) {
          throw new ConflictException("Payment session is being created; retry shortly");
        }
        if (payment.providerOrderId) {
          return this.session(
            payment.id,
            order.id,
            payment.providerOrderId,
            payment.amount.toNumber(),
            order.orderNumber,
          );
        }
      }
    }

    const reservation = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.CREATED,
        providerOrderId: null,
      },
      data: { status: PaymentStatus.PENDING, failureReason: null },
    });
    if (!reservation.count) {
      const current = await this.prisma.payment.findUnique({
        where: { id: payment.id },
      });
      if (current?.providerOrderId) {
        return this.session(
          current.id,
          order.id,
          current.providerOrderId,
          current.amount.toNumber(),
          order.orderNumber,
        );
      }
      throw new ConflictException("Payment session is being created; retry shortly");
    }

    let providerOrder;
    try {
      providerOrder = await this.provider.createOrder({
        amountMinor,
        currency: order.currency,
        receipt: order.orderNumber,
      });
    } catch (error) {
      await this.releasePaymentSessionReservation(payment.id);
      throw error;
    }
    if (
      providerOrder.amount !== amountMinor ||
      providerOrder.currency !== order.currency
    ) {
      // A provider response which does not match the server-calculated order
      // is a financial reconciliation incident. Do not open a second session.
      throw new ServiceUnavailableException(
        "Payment provider returned mismatched order values",
      );
    }
    const initialized = await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerOrderId: providerOrder.id },
    });
    return this.session(
      initialized.id,
      order.id,
      providerOrder.id,
      initialized.amount.toNumber(),
      order.orderNumber,
    );
  }

  async verify(userId: string, input: VerifyPaymentDto) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: input.paymentId, masterOrder: { customer: { userId } } },
      include: { masterOrder: true },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    if (payment.status === PaymentStatus.PAID)
      return this.presentPayment(payment);
    if (payment.providerOrderId !== input.providerOrderId) {
      throw new BadRequestException("Provider order does not match payment");
    }
    const secret = await this.integrationSettings.get("RAZORPAY_KEY_SECRET");
    if (
      !secret ||
      !verifyRazorpaySignature(
        `${input.providerOrderId}|${input.providerPaymentId}`,
        input.providerSignature,
        secret,
      )
    ) {
      throw new UnauthorizedException("Invalid payment signature");
    }
    const providerPayment = await this.provider.fetchPayment(
      input.providerPaymentId,
    );
    this.assertProviderPayment(payment, providerPayment);
    return this.presentPayment(
      (await this.confirmPayment(payment.id, input.providerPaymentId)).payment,
    );
  }

  async reconcile(userId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, masterOrder: { customer: { userId } } },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    if (payment.status === PaymentStatus.PAID || !payment.providerPaymentId) {
      return this.presentPayment(payment);
    }
    const providerPayment = await this.provider.fetchPayment(
      payment.providerPaymentId,
    );
    this.assertProviderPayment(payment, providerPayment);
    return this.presentPayment(
      (await this.confirmPayment(payment.id, providerPayment.id)).payment,
    );
  }

  async status(userId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, masterOrder: { customer: { userId } } },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    return this.presentPayment(payment);
  }

  async webhook(rawBody: Buffer, signature: string | undefined) {
    const secret = await this.integrationSettings.get("RAZORPAY_WEBHOOK_SECRET");
    if (
      !secret ||
      !signature ||
      !verifyRazorpaySignature(rawBody.toString("utf8"), signature, secret)
    ) {
      throw new UnauthorizedException("Invalid webhook signature");
    }
    let payload: WebhookEntity;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as WebhookEntity;
    } catch {
      throw new BadRequestException("Invalid webhook payload");
    }
    const eventType = this.stringValue(payload.event, "event");
    const eventId = createHash("sha256").update(rawBody).digest("hex");
    const claim = await claimProviderEvent(this.prisma, {
      provider: "RAZORPAY",
      eventId,
      eventType,
      payload: payload as Prisma.InputJsonValue,
    });
    if (!claim.claimed) return { accepted: true, duplicate: claim.duplicate };
    await this.processWebhookEvent(eventType, payload, eventId);
    return { accepted: true, duplicate: false };
  }

  async retryFailedWebhookEvent(providerEventId: string) {
    const event = await this.prisma.providerEvent.findUnique({
      where: { id: providerEventId },
    });
    if (!event || event.provider !== "RAZORPAY") {
      throw new NotFoundException("Razorpay provider event not found");
    }
    if (!canRetryProviderEvent(event)) {
      throw new BadRequestException("Only failed or stale provider events can be retried");
    }
    if (!isWebhookEntity(event.payload)) {
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
    await this.processWebhookEvent(event.eventType, event.payload, event.eventId);
    return { accepted: true, retried: true };
  }

  private async processWebhookEvent(
    eventType: string,
    payload: WebhookEntity,
    eventId: string,
  ) {
    try {
      if (eventType === "payment.captured") {
        await this.handlePaymentCaptured(payload);
      } else if (eventType === "payment.failed") {
        await this.handlePaymentFailed(payload);
      } else if (eventType === "refund.processed") {
        await this.handleRefundProcessed(payload);
      } else if (eventType === "refund.failed") {
        await this.handleRefundFailed(payload);
      }
      await completeProviderEvent(this.prisma, "RAZORPAY", eventId);
    } catch (error) {
      await failProviderEvent(
        this.prisma,
        "RAZORPAY",
        eventId,
        error instanceof Error ? error.message : "Webhook processing failed",
      );
      throw error;
    }
  }

  private async confirmPayment(paymentId: string, providerPaymentId: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId },
        });
        if (payment.status === PaymentStatus.PAID) {
          return { payment, changed: false };
        }
        if (!canConfirmPaymentStatus(payment.status)) {
          throw new ConflictException(
            "Captured payment arrived after the payment reached a terminal state; manual reconciliation is required",
          );
        }
        await finalizeMasterOrder(tx, payment.masterOrderId);
        const updated = await tx.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId,
            status: PaymentStatus.PAID,
            verifiedAt: new Date(),
            failureReason: null,
          },
        });
        await tx.masterOrder.update({
          where: { id: payment.masterOrderId },
          data: { status: OrderStatus.CONFIRMED },
        });
        await tx.vendorOrder.updateMany({
          where: { masterOrderId: payment.masterOrderId },
          data: { status: OrderStatus.CONFIRMED },
        });
        await tx.orderItem.updateMany({
          where: { vendorOrder: { masterOrderId: payment.masterOrderId } },
          data: { status: OrderStatus.CONFIRMED },
        });
        return { payment: updated, changed: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (result.changed) {
      await this.notifications
        .notifyPaymentStatus(result.payment.masterOrderId, "PAID")
        .catch(() => undefined);
    }
    return result;
  }

  private async handlePaymentCaptured(payload: WebhookEntity) {
    const entity = this.nestedEntity(payload, "payment");
    const providerPaymentId = this.stringValue(entity.id, "payment.id");
    const providerOrderId = this.stringValue(
      entity.order_id,
      "payment.order_id",
    );
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId },
    });
    if (!payment) throw new NotFoundException("Webhook payment not found");
    this.assertProviderPayment(payment, {
      orderId: providerOrderId,
      amount: this.numberValue(entity.amount, "payment.amount"),
      currency: this.stringValue(entity.currency, "payment.currency"),
      status: "captured",
    });
    await this.confirmPayment(payment.id, providerPaymentId);
  }

  private async handlePaymentFailed(payload: WebhookEntity) {
    const entity = this.nestedEntity(payload, "payment");
    const providerOrderId = this.stringValue(
      entity.order_id,
      "payment.order_id",
    );
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId },
    });
    if (
      !payment ||
      payment.status === PaymentStatus.PAID ||
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.CANCELLED
    ) {
      return;
    }
    const changed = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      if (
        current.status === PaymentStatus.PAID ||
        current.status === PaymentStatus.FAILED ||
        current.status === PaymentStatus.CANCELLED
      ) {
        return false;
      }
      const items = await tx.orderItem.findMany({
        where: { vendorOrder: { masterOrderId: current.masterOrderId } },
        include: { product: { include: { inventory: true } } },
      });
      for (const item of items) {
        await releaseOrderItemInventory(
          tx,
          item,
          "Payment failed; reservation released",
        );
      }
      await tx.payment.update({
        where: { id: current.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason:
            typeof entity.error_description === "string"
              ? entity.error_description
              : "Payment failed",
        },
      });
      await tx.masterOrder.update({
        where: { id: current.masterOrderId },
        data: { status: OrderStatus.CANCELLED },
      });
      await tx.vendorOrder.updateMany({
        where: { masterOrderId: current.masterOrderId },
        data: { status: OrderStatus.CANCELLED },
      });
      await tx.orderItem.updateMany({
        where: { vendorOrder: { masterOrderId: current.masterOrderId } },
        data: {
          status: OrderStatus.CANCELLED,
          cancellable: false,
          cancellationReason: "Payment failed",
        },
      });
      return true;
    });
    if (changed) {
      await this.notifications
        .notifyPaymentStatus(payment.masterOrderId, "FAILED")
        .catch(() => undefined);
    }
  }

  private async handleRefundProcessed(payload: WebhookEntity) {
    const entity = this.nestedEntity(payload, "refund");
    const providerReference = this.stringValue(entity.id, "refund.id");
    const refund = await this.prisma.refund.findUnique({
      where: { providerReference },
    });
    if (!refund) return;
    await this.prisma.$transaction((tx) =>
      completeRefundFinancials(tx, refund.id, providerReference),
    );
  }

  private async handleRefundFailed(payload: WebhookEntity) {
    const entity = this.nestedEntity(payload, "refund");
    const providerReference = this.stringValue(entity.id, "refund.id");
    const refund = await this.prisma.refund.findUnique({
      where: { providerReference },
    });
    // Providers can deliver terminal refund events out of order. A completed
    // financial record is final and must not be reverted by a late failure.
    if (!refund || refund.status === RefundStatus.COMPLETED) return;
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.FAILED,
        failureReason: "Provider failed refund",
      },
    });
  }

  private assertProviderPayment(
    payment: {
      providerOrderId: string | null;
      amount: Prisma.Decimal;
      currency: string;
    },
    providerPayment: {
      orderId?: string;
      amount: number;
      currency: string;
      status: string;
    },
  ) {
    if (
      providerPayment.status !== "captured" ||
      providerPayment.orderId !== payment.providerOrderId ||
      providerPayment.amount !== Math.round(payment.amount.toNumber() * 100) ||
      providerPayment.currency !== payment.currency
    ) {
      throw new BadRequestException(
        "Payment is not captured or does not match the order",
      );
    }
  }

  private nestedEntity(payload: WebhookEntity, kind: string): WebhookEntity {
    const envelope = payload.payload;
    if (!envelope || typeof envelope !== "object") {
      throw new BadRequestException("Invalid webhook payload");
    }
    const wrapped = (envelope as WebhookEntity)[kind];
    if (!wrapped || typeof wrapped !== "object") {
      throw new BadRequestException(`Webhook ${kind} entity is missing`);
    }
    const entity = (wrapped as WebhookEntity).entity;
    if (!entity || typeof entity !== "object") {
      throw new BadRequestException(`Webhook ${kind} entity is missing`);
    }
    return entity as WebhookEntity;
  }

  private stringValue(value: unknown, field: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${field} is missing`);
    }
    return value;
  }

  private numberValue(value: unknown, field: string): number {
    if (typeof value !== "number") {
      throw new BadRequestException(`${field} is missing`);
    }
    return value;
  }

  private async session(
    paymentId: string,
    masterOrderId: string,
    providerOrderId: string,
    amount: number,
    description: string,
  ) {
    return {
      paymentId,
      masterOrderId,
      provider: "RAZORPAY",
      providerOrderId,
      publicKey: await this.integrationSettings.get("RAZORPAY_KEY_ID"),
      amountMinor: Math.round(amount * 100),
      currency: "INR",
      customer: { name: "" },
      description,
    };
  }

  private openPayment(masterOrderId: string) {
    return this.prisma.payment.findFirst({
      where: {
        masterOrderId,
        status: { in: paymentSessionStatuses },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async releasePaymentSessionReservation(paymentId: string) {
    await this.prisma.payment.updateMany({
      where: {
        id: paymentId,
        status: PaymentStatus.PENDING,
        providerOrderId: null,
      },
      data: {
        status: PaymentStatus.CREATED,
        failureReason: "Payment provider session creation failed; retry the payment.",
      },
    });
  }

  private presentPayment(payment: {
    id: string;
    masterOrderId: string;
    provider: string;
    status: PaymentStatus;
    amount: Prisma.Decimal;
    currency: string;
    failureReason: string | null;
    updatedAt: Date;
  }) {
    return {
      id: payment.id,
      masterOrderId: payment.masterOrderId,
      provider: payment.provider,
      status:
        payment.status === PaymentStatus.PENDING ||
        payment.status === PaymentStatus.CREATED
          ? "PAYMENT_PENDING"
          : payment.status,
      amount: {
        amount: payment.amount.toNumber(),
        currency: payment.currency,
      },
      failureMessage: payment.failureReason ?? undefined,
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function isWebhookEntity(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
