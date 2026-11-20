-- Blank image URLs cause browsers to request the current HTML page as an
-- image. They are invalid product media and are safe to remove.
DELETE FROM "ProductImage"
WHERE BTRIM("url") = '';
