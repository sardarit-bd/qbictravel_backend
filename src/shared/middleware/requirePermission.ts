import type { Request, Response, NextFunction } from "express";
import AppError from "../utils/AppError.js";
import type { PermissionId } from "../../modules/permission/permissionConstants.js";
import { checkStaffPermission } from "../../modules/permission/permissionRepository.js";

/**
 * Authorization middleware enforcing fine-grained permissions for Staff members.
 *
 * Rules:
 * 1. Requires authenticated user (authMiddleware must run first).
 * 2. "admin" role bypasses all checks with unrestricted access.
 * 3. "staff" role is checked against explicitly assigned permissions in PostgreSQL.
 * 4. "customer" and "agent" roles are strictly denied (403) from administrative operations.
 */
export const requirePermission = (
  permission: PermissionId | PermissionId[]
) => {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      return next(new AppError("Unauthorized", 401));
    }

    // 1. Admin bypass: Full unrestricted access
    if (req.user.role === "admin") {
      return next();
    }

    // 2. Strict isolation: Only staff can hold staff permissions
    if (req.user.role !== "staff") {
      return next(new AppError("Forbidden: insufficient permissions", 403));
    }

    // 3. Staff permission verification against database
    try {
      const requiredPermissions = Array.isArray(permission)
        ? permission
        : [permission];

      // Staff must have at least one of the specified permissions (or all if single)
      let hasAccess = false;
      for (const perm of requiredPermissions) {
        const allowed = await checkStaffPermission(req.user.id, perm);
        if (allowed) {
          hasAccess = true;
          break;
        }
      }

      if (!hasAccess) {
        return next(
          new AppError("Forbidden: insufficient permissions", 403)
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

export default requirePermission;
