-- Match the public catalogue's approved-product price sorts. These indexes are
-- additive, so listings stay available while the migration is applied.
CREATE INDEX "Product_status_price_idx" ON "Product"("status", "price");
CREATE INDEX "Product_categoryId_status_price_idx" ON "Product"("categoryId", "status", "price");
