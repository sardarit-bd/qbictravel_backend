import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as permissionService from "./permissionService.js";

export const getCatalog = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const catalog = await permissionService.getPermissionCatalog();
    sendResponse(res, 200, true, "Permission catalog retrieved successfully", catalog);
  } catch (error) {
    next(error);
  }
};

export const getStaffPermissions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const staffId = req.params.staffId as string;
    const permissions = await permissionService.getStaffPermissions(staffId);
    sendResponse(res, 200, true, "Staff permissions retrieved successfully", permissions);
  } catch (error) {
    next(error);
  }
};

export const updateStaffPermissions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actorId = req.user!.id;
    const staffId = req.params.staffId as string;
    const { permissions } = req.body as { permissions: string[] };

    const result = await permissionService.updateStaffPermissions(
      actorId,
      staffId,
      permissions
    );
    sendResponse(res, 200, true, "Staff permissions updated successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getMyPermissions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, role } = req.user!;
    const effective = await permissionService.getEffectivePermissions(id, role);
    sendResponse(res, 200, true, "Effective permissions retrieved successfully", effective);
  } catch (error) {
    next(error);
  }
};
