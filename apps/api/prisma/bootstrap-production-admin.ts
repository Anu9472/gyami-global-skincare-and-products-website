import { PrismaClient, Role } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function bootstrapProductionAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error(
      "ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters are required for the production admin bootstrap",
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== Role.ADMIN) {
      throw new Error("ADMIN_EMAIL is already assigned to a non-administrator account");
    }
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password, 12),
      role: Role.ADMIN,
    },
  });
}

bootstrapProductionAdmin().finally(async () => prisma.$disconnect());
