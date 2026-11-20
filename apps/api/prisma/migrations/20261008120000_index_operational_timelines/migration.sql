-- Keep high-traffic vendor/admin timelines and the settlement eligibility
-- recovery job index-backed as operational history grows.
CREATE INDEX "VendorOrder_vendorId_createdAt_idx"
  ON "VendorOrder"("vendorId", "createdAt");

CREATE INDEX "VendorOrder_settlementStatus_settlementEligibleAt_idx"
  ON "VendorOrder"("settlementStatus", "settlementEligibleAt");

CREATE INDEX "Settlement_vendorId_createdAt_idx"
  ON "Settlement"("vendorId", "createdAt");

CREATE INDEX "Notification_createdAt_idx"
  ON "Notification"("createdAt");

CREATE INDEX "AuditLog_createdAt_idx"
  ON "AuditLog"("createdAt");
