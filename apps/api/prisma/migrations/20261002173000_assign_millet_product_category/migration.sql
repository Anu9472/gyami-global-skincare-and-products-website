-- Correct the approved test millet product that was created under the generic
-- Food Products category. Category pages filter by the stored category ID, so
-- this item belongs to the dedicated Millets category.
UPDATE "Product"
SET "categoryId" = (
    SELECT "id"
    FROM "Category"
    WHERE "slug" = 'millets'
)
WHERE "slug" = 'live-test-millet-mix-32c8c5'
  AND EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'millets');
