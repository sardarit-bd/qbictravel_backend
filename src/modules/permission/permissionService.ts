import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import {
  SUPPORTED_PERMISSIONS,
  SUPPORTED_PERMISSION_IDS_SET,
  PERMISSION_MODULES,
  MANDATORY_STAFF_PERMISSIONS,
  MANDATORY_STAFF_PERMISSIONS_SET,
  DEFAULT_STAFF_PERMISSIONS,
  type PermissionDefinition,
} from "./permissionConstants.js";
import * as permissionRepo from "./permissionRepository.js";
import type {
  PermissionCatalogResponse,
  StaffPermissionsResponse,
  EffectivePermissionsResponse,
} from "./permissionTypes.js";

/**
 * Retrieve the full categorized permissions catalog.
 * Excludes mandatory system-level staff permissions so Admin only sees and manages optional permissions.
 */
export const getPermissionCatalog = async (): Promise<PermissionCatalogResponse> => {
  // Ensure the permission catalog is seeded in the database
  await permissionRepo.seedSupportedPermissions();

  const permissions = await permissionRepo.listAllPermissions();

  // Filter out mandatory system permissions from editable catalog
  const optionalPermissions = permissions.filter(
    (p) => !MANDATORY_STAFF_PERMISSIONS_SET.has(p.id)
  );

  // Group by module according to PERMISSION_MODULES sequence
  const groupedModules: { module: string; permissions: PermissionDefinition[] }[] = [];

  for (const mod of PERMISSION_MODULES) {
    const modPermissions = optionalPermissions.filter((p) => p.module === mod);
    if (modPermissions.length > 0) {
      groupedModules.push({
        module: mod,
        permissions: modPermissions,
      });
    }
  }

  return {
    modules: groupedModules,
    totalPermissions: optionalPermissions.length,
  };
};

/**
 * Retrieve assigned permissions for a staff member
 */
/**
 * Retrieve assigned permissions for a staff member.
 * Filters out system-level mandatory permissions so Admin only sees and manages optional permissions.
 */
export const getStaffPermissions = async (
  staffId: string
): Promise<StaffPermissionsResponse> => {
  const user = await prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    throw new AppError("Staff account not found", 404);
  }

  if (user.role !== "staff") {
    throw new AppError(
      "Permissions can only be viewed or managed for staff accounts",
      400
    );
  }

  const permissions = await permissionRepo.getStaffAssignedPermissions(staffId);

  // Return only optional permissions for Admin management
  const optionalPermissions = permissions.filter(
    (pId) => !MANDATORY_STAFF_PERMISSIONS_SET.has(pId)
  );

  return {
    staffId: user.id,
    staffName: user.name,
    staffEmail: user.email,
    permissions: optionalPermissions,
  };
};

/**
 * Replace permissions assigned to a staff member (Admin-only).
 * Filters out mandatory permissions from input, merges mandatory permissions at repository level,
 * and returns only the granted optional permissions.
 */
export const updateStaffPermissions = async (
  actorId: string,
  staffId: string,
  permissionIds: string[]
): Promise<StaffPermissionsResponse> => {
  const user = await prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    throw new AppError("Staff account not found", 404);
  }

  if (user.role !== "staff") {
    throw new AppError(
      "Permissions can only be assigned to staff accounts",
      400
    );
  }

  // Validate that all supplied permission IDs are known and supported
  const invalidIds = permissionIds.filter(
    (id) => !SUPPORTED_PERMISSION_IDS_SET.has(id)
  );

  if (invalidIds.length > 0) {
    throw new AppError(
      `Invalid permission ID(s) supplied: ${invalidIds.join(", ")}`,
      400
    );
  }

  // Deduplicate IDs safely
  const uniqueIds = Array.from(new Set(permissionIds));

  // Atomic update in PostgreSQL (repository ensures mandatory permissions are retained)
  const updatedPermissions = await permissionRepo.replaceStaffPermissions(
    staffId,
    uniqueIds,
    actorId
  );

  // Return only optional permissions to the Admin management API
  const optionalPermissions = updatedPermissions.filter(
    (pId) => !MANDATORY_STAFF_PERMISSIONS_SET.has(pId)
  );

  return {
    staffId: user.id,
    staffName: user.name,
    staffEmail: user.email,
    permissions: optionalPermissions,
  };
};

/**
 * Retrieve effective permissions for the authenticated user.
 * Always includes mandatory permissions for staff.
 */
export const getEffectivePermissions = async (
  userId: string,
  role: string
): Promise<EffectivePermissionsResponse> => {
  const permissions = await permissionRepo.getUserEffectivePermissions(userId, role);

  return {
    userId,
    role,
    isAdmin: role === "admin",
    permissions,
  };
};
