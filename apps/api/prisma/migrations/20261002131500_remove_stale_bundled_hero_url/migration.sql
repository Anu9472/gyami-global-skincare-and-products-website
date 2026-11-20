-- Vite asset filenames are content hashed and must never be persisted in the
-- database. Clear the legacy seeded URL so the storefront uses its bundled,
-- optimized fallback image until an administrator uploads a managed hero.
UPDATE "HomeHeroSlide"
SET "imageUrl" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "imageUrl" = '/assets/vishwaneed_hero_vegetables_image-BFvquqM8.png';
