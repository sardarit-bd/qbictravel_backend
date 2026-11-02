import { prisma } from "../../lib/prisma.js";
import {
  SUPPORTED_PERMISSIONS,
  ALL_PERMISSION_IDS,
  type PermissionDefinition,
} from "./permissionConstants.js";

/**
 * Seed all supported permissions idempotently into the database
 */
export const seedSupportedPermissions = async (): Promise<void> => {
  for (const p of SUPPORTED_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        name: p.name,
        module: p.module,
        description: p.description,
      },
      update: {
        name: p.name,
        module: p.module,
        description: p.description,
      },
    });
  }
};

/**
 * Retrieve all registered permissions from the database
 */
export const listAllPermissions = async (): Promise<PermissionDefinition[]> => {
  const records = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { id: "asc" }],
  });
  return records.map((p) => ({
    id: p.id,
    name: p.name,
    module: p.module,
    description: p.description ?? "",
  }));
};

/**
 * Get assigned permission records for a specific staff user
 */
export const getStaffAssignedPermissions = async (
  staffId: string
): Promise<string[]> => {
  const records = await prisma.staffPermission.findMany({
    where: { userId: staffId },
    select: { permissionId: true },
    orderBy: { permissionId: "asc" },
  });
  return records.map((r) => r.permissionId);
};

/**
 * Replace all permissions for a staff member in a single atomic transaction
 */
export const replaceStaffPermissions = async (
  staffId: string,
  permissionIds: string[],
  assignedById?: string
): Promise<string[]> => {
  await seedSupportedPermissions();
  return prisma.$transaction(async (tx) => {
    // 1. Delete all currently assigned permissions for this staff member
    await tx.staffPermission.deleteMany({
      where: { userId: staffId },
    });

    // 2. Insert new permission assignments (if any provided)
    if (permissionIds.length > 0) {
      await tx.staffPermission.createMany({
        data: permissionIds.map((pId) => ({
          userId: staffId,
          permissionId: pId,
          assignedById: assignedById ?? null,
        })),
        skipDuplicates: true,
      });
    }

    // 3. Return the fresh assigned list
    const updated = await tx.staffPermission.findMany({
      where: { userId: staffId },
      select: { permissionId: true },
      orderBy: { permissionId: "asc" },
    });

    return updated.map((r) => r.permissionId);
  });
};

/**
 * Check if a specific staff member has a given permission
 */
export const checkStaffPermission = async (
  staffId: string,
  permissionId: string
): Promise<boolean> => {
  const count = await prisma.staffPermission.count({
    where: {
      userId: staffId,
      permissionId,
    },
  });
  return count > 0;
};

/**
 * Get all effective permission IDs for a user based on role and database assignments
 */
export const getUserEffectivePermissions = async (
  userId: string,
  role: string
): Promise<string[]> => {
  if (role === "admin") {
    // Admins implicitly have unrestricted access to all permissions
    return [...ALL_PERMISSION_IDS];
  }

  if (role === "staff") {
    return getStaffAssignedPermissions(userId);
  }

  // Customers and agents have 0 administrative permissions
  return [];
};
