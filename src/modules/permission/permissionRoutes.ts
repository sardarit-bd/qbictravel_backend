import { Router } from "express";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import validate from "../../shared/middleware/validate.js";
import * as permissionController from "./permissionController.js";
import {
  staffIdParamSchema,
  updateStaffPermissionsSchema,
} from "./permissionValidators.js";

const router = Router();

/**
 * Public/authenticated endpoint: View own effective permissions
 * GET /api/v1/auth/me/permissions
 */
export const myPermissionsRouter = Router();
myPermissionsRouter.get(
  "/me/permissions",
  authMiddleware,
  permissionController.getMyPermissions
);

/**
 * Admin-only endpoints for managing staff permissions
 */
// List the complete supported permissions catalog
router.get(
  "/permissions",
  authMiddleware,
  requireRole("admin"),
  permissionController.getCatalog
);

// View assigned permissions for a staff member
router.get(
  "/staff/:staffId/permissions",
  authMiddleware,
  requireRole("admin"),
  validate(staffIdParamSchema, "params"),
  permissionController.getStaffPermissions
);

// Replace assigned permissions for a staff member
router.put(
  "/staff/:staffId/permissions",
  authMiddleware,
  requireRole("admin"),
  validate(staffIdParamSchema, "params"),
  validate(updateStaffPermissionsSchema),
  permissionController.updateStaffPermissions
);

export default router;
