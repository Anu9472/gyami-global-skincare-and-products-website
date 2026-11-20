-- Keeps admin recovery queues and newest-first provider-event history responsive
-- as payment and shipping webhook volume grows.
CREATE INDEX "ProviderEvent_processedAt_failureReason_idx"
  ON "ProviderEvent"("processedAt", "failureReason");

CREATE INDEX "ProviderEvent_processedAt_processingAt_idx"
  ON "ProviderEvent"("processedAt", "processingAt");

CREATE INDEX "ProviderEvent_createdAt_idx"
  ON "ProviderEvent"("createdAt");
