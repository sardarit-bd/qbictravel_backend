import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import { assignStaffDefaultPermissions } from "../src/modules/permission/permissionRepository.js";

const name = process.env.ADMIN_NAME || "Platform Admin";
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

async function main() {
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`Admin seed skipped: ${email} already exists`);
  } else {
    await prisma.user.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(password, 10),
        role: "admin",
      },
    });
    console.log(`Admin created: ${email}`);
  }

  // Ensure any existing staff accounts without permissions receive default operational permissions
  const staffUsers = await prisma.user.findMany({
    where: { role: "staff", deletedAt: null },
    select: { id: true, email: true },
  });

  for (const staff of staffUsers) {
    const existingPermsCount = await prisma.staffPermission.count({
      where: { userId: staff.id },
    });
    if (existingPermsCount === 0) {
      await assignStaffDefaultPermissions(staff.id);
      console.log(`Default staff permissions assigned to: ${staff.email}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());