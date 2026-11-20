import {
  InspectionStatus,
  PrismaClient,
  ProductStatus,
  ProductType,
  Role,
  VendorDocumentType,
  VendorStatus,
  VerificationStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { createCipheriv, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

async function seed(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 12) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters) are required for seeding",
    );
  }
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    create: {
      email: adminEmail.toLowerCase(),
      passwordHash: await hash(adminPassword, 12),
      role: Role.ADMIN,
    },
    update: {},
  });
  const customerPassword = process.env.DEMO_CUSTOMER_PASSWORD ?? adminPassword;
  const customerUser = await prisma.user.upsert({
    where: { email: "customer@gyami.test" },
    create: {
      email: "customer@gyami.test",
      mobile: "9876543210",
      mobileVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      passwordHash: await hash(customerPassword, 12),
      role: Role.CUSTOMER,
    },
    update: {
      mobileVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      passwordHash: await hash(customerPassword, 12),
    },
  });
  const customer = await prisma.customerProfile.upsert({
    where: { userId: customerUser.id },
    create: {
      userId: customerUser.id,
      firstName: "Demo",
      lastName: "Customer",
      cart: { create: {} },
    },
    update: { firstName: "Demo", lastName: "Customer" },
  });
  if ((await prisma.address.count({ where: { customerId: customer.id } })) === 0) {
    await prisma.address.create({
      data: {
        customerId: customer.id,
        label: "Home",
        recipientName: "Demo Customer",
        mobile: "9876543210",
        line1: "24 Test Market Road",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
        isDefault: true,
      },
    });
  }
  const vendorEmail = (process.env.DEMO_VENDOR_EMAIL ?? "business@gyami.test").toLowerCase();
  const vendorPassword = process.env.DEMO_VENDOR_PASSWORD ?? adminPassword;
  const vendorUser = await prisma.user.upsert({
    where: { email: vendorEmail },
    create: {
      email: vendorEmail,
      mobile: "9876543211",
      mobileVerifiedAt: new Date(),
      emailVerifiedAt: new Date(),
      passwordHash: await hash(vendorPassword, 12),
      role: Role.VENDOR,
    },
    update: { passwordHash: await hash(vendorPassword, 12) },
  });
  const vendor = await prisma.vendor.upsert({
    where: { userId: vendorUser.id },
    create: {
      userId: vendorUser.id,
      businessName: "GYAMI Global Private Limited",
      legalName: "GYAMI Global Private Limited",
      ownerName: "Demo Vendor",
      businessEmail: vendorEmail,
      businessMobile: "9876543211",
      businessAddress: { line1: "12 Market Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
      pickupPincode: "411001",
      status: VendorStatus.APPROVED,
      approvedAt: new Date(),
    },
    update: { status: VendorStatus.APPROVED, approvedAt: new Date() },
  });
  const requiredDocuments = [
    VendorDocumentType.PAN,
    VendorDocumentType.AADHAAR,
    VendorDocumentType.GST_CERTIFICATE,
    VendorDocumentType.FSSAI_LICENSE,
    VendorDocumentType.CANCELLED_CHEQUE,
    VendorDocumentType.BUSINESS_REGISTRATION_PROOF,
  ];
  for (const type of requiredDocuments) {
    await prisma.vendorDocument.upsert({
      where: { vendorId_type: { vendorId: vendor.id, type } },
      create: {
        vendorId: vendor.id,
        type,
        originalName: `${type.toLowerCase()}-demo.pdf`,
        storageKey: `seed/${vendor.id}/${type.toLowerCase()}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: VerificationStatus.VERIFIED,
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
      },
      update: {
        status: VerificationStatus.VERIFIED,
        rejectionReason: null,
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
      },
    });
  }
  const encryptionKey = process.env.BANK_DATA_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("BANK_DATA_ENCRYPTION_KEY is required for seeding");
  const key = /^[a-fA-F0-9]{64}$/.test(encryptionKey)
    ? Buffer.from(encryptionKey, "hex")
    : Buffer.from(encryptionKey, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encryptedAccount = Buffer.concat([
    cipher.update("123456789012", "utf8"),
    cipher.final(),
  ]);
  const accountNumberEncrypted = `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encryptedAccount.toString("base64")}`;
  await prisma.vendorBankAccount.deleteMany({ where: { vendorId: vendor.id } });
  await prisma.vendorBankAccount.create({
    data: {
      vendorId: vendor.id,
      accountHolderName: "GYAMI Global Private Limited",
      accountNumberEncrypted,
      accountNumberLast4: "9012",
      ifsc: "HDFC0000123",
      bankName: "HDFC Bank",
      branchName: "Pune Main",
      isPrimary: true,
      status: VerificationStatus.VERIFIED,
    },
  });
  await prisma.vendorInspection.deleteMany({ where: { vendorId: vendor.id } });
  await prisma.vendorInspection.create({
    data: {
      vendorId: vendor.id,
      inspectorId: adminUser.id,
      scheduledAt: new Date("2026-09-15T09:00:00.000Z"),
      inspectedAt: new Date("2026-09-15T11:00:00.000Z"),
      location: "12 Market Road, Pune, Maharashtra 411001",
      checklist: { identity: true, licences: true, premises: true, quality: true },
      remarks: "Development vendor inspection completed successfully.",
      documentsVerified: true,
      premisesVerified: true,
      qualityVerified: true,
      evidence: { source: "development-seed" },
      status: InspectionStatus.PASSED,
    },
  });
  const categories = [
    ["Skincare", "skincare"],
    ["Home Care", "home-care"],
  ] as const;
  for (const [name, slug] of categories) {
    await prisma.category.upsert({
      where: { slug },
      create: { name, slug },
      update: { name, isActive: true },
    });
  }
  const skincareCategory = await prisma.category.findUniqueOrThrow({ where: { slug: "skincare" } });
  const homeCareCategory = await prisma.category.findUniqueOrThrow({ where: { slug: "home-care" } });
  const demoProducts = [
    {
      categoryId: skincareCategory.id,
      name: "Vitamin C Facewash",
      slug: "vitamin-c-facewash",
      description: "A 100 ml daily facewash with vitamin C, aloe vera and botanical extracts.",
      productType: ProductType.VALUE_ADDED,
      price: 199,
      mrp: 249,
      gstRate: 18,
      weightGrams: 100,
    },
    {
      categoryId: skincareCategory.id,
      name: "Charcoal Facewash",
      slug: "charcoal-facewash",
      description: "A 100 ml charcoal facewash with aloe vera and neem extracts for a modern cleansing ritual.",
      productType: ProductType.VALUE_ADDED,
      price: 199,
      mrp: 249,
      gstRate: 18,
      weightGrams: 100,
    },
    {
      categoryId: skincareCategory.id,
      name: "Haldi Chandan Facewash",
      slug: "haldi-chandan-facewash",
      description: "A 100 ml Ayurvedic-inspired facewash with turmeric and sandalwood extracts.",
      productType: ProductType.VALUE_ADDED,
      price: 199,
      mrp: 249,
      gstRate: 18,
      weightGrams: 100,
    },
    {
      categoryId: skincareCategory.id,
      name: "Gold Kesar Facewash",
      slug: "gold-kesar-facewash",
      description: "A 100 ml premium saffron-inspired facewash in GYAMI Global's signature presentation.",
      productType: ProductType.VALUE_ADDED,
      price: 0,
      mrp: 0,
      gstRate: 18,
      weightGrams: 100,
    },
    {
      categoryId: skincareCategory.id,
      name: "GYAMI Facewash Trio Combo",
      slug: "facewash-trio-combo",
      description: "Vitamin C, Charcoal and Haldi Chandan facewash together in one launch collection.",
      productType: ProductType.VALUE_ADDED,
      price: 549,
      mrp: 747,
      gstRate: 18,
      weightGrams: 300,
    },
    {
      categoryId: homeCareCategory.id,
      name: "Detergent Liquid",
      slug: "detergent-liquid",
      description: "A deep-clean liquid detergent designed for effective stain removal, fabric care and lasting freshness.",
      productType: ProductType.VALUE_ADDED,
      price: 0,
      mrp: 0,
      gstRate: 18,
      weightGrams: 1000,
    },
  ];
  for (const item of demoProducts) {
    await prisma.product.upsert({
      where: { slug: item.slug },
      create: {
        ...item,
        vendorId: vendor.id,
        status: ProductStatus.APPROVED,
        approvedAt: new Date(),
        inventory: { create: { quantity: item.price > 0 ? 300 : 0, lowStockThreshold: 10 } },
      },
      // These are deterministic demonstration products used by the local/CI
      // workflow smoke test. Reset only their inventory so reseeding is
      // repeatable after an earlier smoke order consumed stock.
      update: {
        ...item,
        status: ProductStatus.APPROVED,
        inventory: {
          upsert: {
            create: { quantity: item.price > 0 ? 300 : 0, lowStockThreshold: 10 },
            update: { quantity: item.price > 0 ? 300 : 0, reserved: 0, lowStockThreshold: 10 },
          },
        },
      },
    });
  }
  const existingRules = await prisma.commissionRule.count();
  if (existingRules === 0) {
    await prisma.commissionRule.createMany({
      data: [
        {
          productType: ProductType.RAW_COMMODITY,
          percentage: 14,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          productType: ProductType.VALUE_ADDED,
          percentage: 18,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });
  }
}

seed().finally(async () => prisma.$disconnect());
