-- Supports the public catalogue's common category + approval-state filter,
-- while preserving created-at ordering without a table scan as data grows.
CREATE INDEX "Product_categoryId_status_createdAt_idx"
  ON "Product"("categoryId", "status", "createdAt");
