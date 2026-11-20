import { Prisma } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";

export const PROVIDER_EVENT_PROCESSING_LEASE_MS = 5 * 60_000;

export type ProviderEventClaim = {
  claimed: boolean;
  duplicate: boolean;
};

export function isProviderEventProcessingLeaseStale(
  processingAt: Date | null,
  now = new Date(),
) {
  return Boolean(
    processingAt &&
      processingAt.getTime() < now.getTime() - PROVIDER_EVENT_PROCESSING_LEASE_MS,
  );
}

export function canRetryProviderEvent(
  event: {
    processedAt: Date | null;
    processingAt: Date | null;
    failureReason: string | null;
  },
  now = new Date(),
) {
  return !event.processedAt && (
    Boolean(event.failureReason) ||
    isProviderEventProcessingLeaseStale(event.processingAt, now)
  );
}

/**
 * Stores a verified provider event and atomically leases its processing.
 *
 * Provider webhooks are routinely delivered more than once.  A unique event
 * record alone is not sufficient because two requests can both read an
 * unprocessed row.  The lease makes the side-effecting handler single-owner;
 * it also expires so an interrupted process does not leave an event stuck.
 */
export async function claimProviderEvent(
  prisma: PrismaService,
  input: {
    provider: string;
    eventId: string;
    eventType: string;
    payload: Prisma.InputJsonValue;
  },
): Promise<ProviderEventClaim> {
  const eventKey = { provider: input.provider, eventId: input.eventId };
  await prisma.providerEvent.upsert({
    where: { provider_eventId: eventKey },
    create: input,
    update: {},
  });

  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROVIDER_EVENT_PROCESSING_LEASE_MS);
  const claim = await prisma.providerEvent.updateMany({
    where: {
      ...eventKey,
      processedAt: null,
      OR: [
        { processingAt: null },
        { processingAt: { lt: staleBefore } },
      ],
    },
    data: {
      processingAt: now,
      processingAttempts: { increment: 1 },
      failureReason: null,
    },
  });
  if (claim.count === 1) return { claimed: true, duplicate: false };

  const existing = await prisma.providerEvent.findUnique({
    where: { provider_eventId: eventKey },
    select: { processedAt: true },
  });
  return { claimed: false, duplicate: Boolean(existing?.processedAt) };
}

export function completeProviderEvent(
  prisma: PrismaService,
  provider: string,
  eventId: string,
) {
  return prisma.providerEvent.update({
    where: { provider_eventId: { provider, eventId } },
    data: { processedAt: new Date(), processingAt: null, failureReason: null },
  });
}

export function failProviderEvent(
  prisma: PrismaService,
  provider: string,
  eventId: string,
  failureReason: string,
) {
  return prisma.providerEvent.update({
    where: { provider_eventId: { provider, eventId } },
    data: { processingAt: null, failureReason },
  });
}
