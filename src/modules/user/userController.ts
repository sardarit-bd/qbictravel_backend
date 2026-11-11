import { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import {
  getOwnProfile,
  updateOwnProfile,
  updateOwnEmail,
  generateAvatarUploadSignature,
  confirmAvatarUpload,
  removeOwnAvatar,
} from "./userService.js";

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

export const updateEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await updateOwnEmail(req.user!.id, req.body);
    sendResponse(res, 200, true, "Email updated successfully", profile);
  } catch (error) {
    next(error);
  }
};

export const createAvatarSignature = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const signatureData = await generateAvatarUploadSignature(req.user!.id);
    sendResponse(res, 200, true, "Avatar upload signature generated successfully", signatureData);
  } catch (error) {
    next(error);
  }
};

export const confirmAvatar = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await confirmAvatarUpload(req.user!.id, req.body);
    sendResponse(res, 200, true, "Profile avatar updated successfully", profile);
  } catch (error) {
    next(error);
  }
};

export const removeAvatar = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await removeOwnAvatar(req.user!.id);
    sendResponse(res, 200, true, "Profile avatar removed successfully", profile);
  } catch (error) {
    next(error);
  }
};
