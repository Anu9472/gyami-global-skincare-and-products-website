-- Makes webhook processing single-owner while allowing interrupted deliveries
-- to be retried after a short lease expiry.
ALTER TABLE "ProviderEvent"
  ADD COLUMN "processingAt" TIMESTAMP(3),
  ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ProviderEvent_provider_processingAt_idx"
  ON "ProviderEvent"("provider", "processingAt");
