import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const prisma = new PrismaClient();

const slides = [
  {
    id: "e911b71a-5ac8-4dbb-81aa-9ff5b83861af",
    source: "assets/gyami-brand-banner.jpeg",
    eyebrow: "Premium Skincare & Beauty",
    title: "Where science meets luxury.",
    description:
      "Discover thoughtful personal care created around performance, elegance and experience.",
    ctaLabel: "Discover GYAMI",
    ctaHref: "/products",
    imageAlt: "GYAMI Global luxury beauty and personal care brand",
  },
  {
    id: "ef11b71a-5ac8-4dbb-81aa-9ff5b83861af",
    source: "assets/gyami-facewash-collection-clean.webp",
    eyebrow: "Daily Routine Skincare",
    title: "Beauty as a daily ritual.",
    description:
      "Explore three facewashes designed to make everyday care feel considered and refined.",
    ctaLabel: "Explore skincare",
    ctaHref: "/products?category=skincare",
    imageAlt: "GYAMI Global Vitamin C, Charcoal and Haldi Chandan Papaya facewashes",
  },
  {
    id: "f011b71a-5ac8-4dbb-81aa-9ff5b83861af",
    source: "assets/gyami-detergent-liquid.jpeg",
    eyebrow: "Premium Home Care",
    title: "Care in every detail.",
    description:
      "Meet the GYAMI detergent liquid, created for powerful cleaning and thoughtful fabric care.",
    ctaLabel: "Explore home care",
    ctaHref: "/products?category=home-care",
    imageAlt: "Front and back views of GYAMI Global detergent liquid",
  },
] as const;

async function heroImage(source: string) {
  const bytes = await readFile(resolve(__dirname, source));
  return sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: 1600, height: 800, fit: "cover", position: "attention" })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
}

async function seedHomeHero(): Promise<void> {
  for (const [sortOrder, slide] of slides.entries()) {
    const { source, ...slideData } = slide;
    const existing = await prisma.homeHeroSlide.findUnique({
      where: { id: slide.id },
      select: { imageData: true },
    });
    if (existing?.imageData) continue;

    const imageData = await heroImage(source);
    const digest = createHash("sha256")
      .update(imageData)
      .digest("hex")
      .slice(0, 16);
    const imageUrl = `/api/v1/home-hero-images/${slide.id}-${digest}.webp`;

    await prisma.homeHeroSlide.upsert({
      where: { id: slide.id },
      create: {
        ...slideData,
        imageUrl,
        imageData,
        imageMimeType: "image/webp",
        isActive: true,
        sortOrder,
      },
      update: { imageUrl, imageData, imageMimeType: "image/webp" },
    });
  }
}

seedHomeHero().finally(async () => prisma.$disconnect());
