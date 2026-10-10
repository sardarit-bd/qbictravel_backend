import { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import { getOwnProfile, updateOwnProfile } from "./userService.js";

export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await getOwnProfile(req.user!.id);

    sendResponse(res, 200, true, "Profile retrieved successfully", profile);
  } catch (error) {
    next(error);
  }
};

export const updateMe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await updateOwnProfile(req.user!.id, req.body);

    sendResponse(res, 200, true, "Profile updated successfully", profile);
  } catch (error) {
    next(error);
  }
};