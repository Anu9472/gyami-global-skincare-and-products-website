import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../src/database/prisma.service";
import {
  canRetryProviderEvent,
  claimProviderEvent,
  completeProviderEvent,
  failProviderEvent,
  isProviderEventProcessingLeaseStale,
} from "../src/common/provider-events";

describe("provider webhook event leases", () => {
  it("claims an unprocessed event exactly once before business side effects run", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      providerEvent: { upsert, updateMany, findUnique: vi.fn() },
    } as unknown as PrismaService;

    await expect(claimProviderEvent(prisma, {
      provider: "RAZORPAY",
      eventId: "event-1",
      eventType: "payment.captured",
      payload: { event: "payment.captured" },
    })).resolves.toEqual({ claimed: true, duplicate: false });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider_eventId: { provider: "RAZORPAY", eventId: "event-1" } },
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: "RAZORPAY",
        eventId: "event-1",
        processedAt: null,
      }) as object,
      data: expect.objectContaining({ processingAttempts: { increment: 1 } }) as object,
    }));
  });

  it("does not claim an event already processed by another delivery", async () => {
    const findUnique = vi.fn().mockResolvedValue({ processedAt: new Date() });
    const prisma = {
      providerEvent: {
        upsert: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique,
      },
    } as unknown as PrismaService;

    await expect(claimProviderEvent(prisma, {
      provider: "SHIPROCKET",
      eventId: "event-2",
      eventType: "DELIVERED",
      payload: { status: "DELIVERED" },
    })).resolves.toEqual({ claimed: false, duplicate: true });
  });

  it("only permits recovery for failed or expired processing leases", () => {
    const now = new Date("2026-10-08T04:00:00.000Z");
    const staleLease = new Date("2026-10-08T03:54:59.999Z");
    const activeLease = new Date("2026-10-08T03:59:00.000Z");

    expect(isProviderEventProcessingLeaseStale(staleLease, now)).toBe(true);
    expect(isProviderEventProcessingLeaseStale(activeLease, now)).toBe(false);
    expect(canRetryProviderEvent({
      processedAt: null,
      processingAt: null,
      failureReason: "Provider timeout",
    }, now)).toBe(true);
    expect(canRetryProviderEvent({
      processedAt: null,
      processingAt: staleLease,
      failureReason: null,
    }, now)).toBe(true);
    expect(canRetryProviderEvent({
      processedAt: null,
      processingAt: activeLease,
      failureReason: null,
    }, now)).toBe(false);
    expect(canRetryProviderEvent({
      processedAt: now,
      processingAt: null,
      failureReason: "Provider timeout",
    }, now)).toBe(false);
  });

  it("clears the lease after successful or failed processing", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = { providerEvent: { update } } as unknown as PrismaService;

    await completeProviderEvent(prisma, "RAZORPAY", "event-3");
    await failProviderEvent(prisma, "RAZORPAY", "event-3", "Provider timeout");

    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ processingAt: null, failureReason: null }) as object,
    }));
    expect(update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: { processingAt: null, failureReason: "Provider timeout" },
    }));
  });
});
