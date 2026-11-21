import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as mediaService from "./mediaService.js";
import type { GetMediaQuery } from "./mediaTypes.js";

export const createSignature = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const adminId = req.user!.id;
    const signatureData = await mediaService.generateUploadSignature(
      req.body,
      adminId,
    );
    sendResponse(
      res,
      200,
      true,
      "Upload signature generated successfully",
      signatureData,
    );
  } catch (error) {
    next(error);
  }
};

export const confirmAsset = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { media, isDuplicate } = await mediaService.confirmUploadedAsset(
      req.body,
      userId,
    );

    const statusCode = isDuplicate ? 200 : 201;
    const message = isDuplicate
      ? "Media asset already confirmed"
      : "Media confirmed and persisted successfully";

    sendResponse(res, statusCode, true, message, media);
  } catch (error) {
    next(error);
  }
};

export const listMedia = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = (res.locals.query || req.query) as GetMediaQuery;
    const result = await mediaService.listMedia(query);
    sendResponse(res, 200, true, "Media retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getMediaById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const mediaId = String(req.params.mediaId);
    const media = await mediaService.getMediaById(mediaId);
    sendResponse(res, 200, true, "Media details retrieved successfully", media);
  } catch (error) {
    next(error);
  }
};

export const deleteMedia = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const mediaId = String(req.params.mediaId);
    const result = await mediaService.deleteMedia(mediaId);
    sendResponse(res, 200, true, "Media deleted successfully", result);
  } catch (error) {
    next(error);
  }
};

export const bulkDeleteMedia = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { mediaIds } = req.body as { mediaIds: string[] };
    const result = await mediaService.bulkDeleteMedia(mediaIds);
    sendResponse(res, 200, true, "Bulk deletion processed", result);
  } catch (error) {
    next(error);
  }
};

export const bulkAttachDetachMedia = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const result = await mediaService.bulkAttachDetachMedia(req.body);
    sendResponse(res, 200, true, "Bulk attachment processed successfully", result);
  } catch (error) {
    next(error);
  }
};

export const syncAsset = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const mediaId = String(req.params.mediaId);
    const result = await mediaService.syncAssetFromCloudinary(mediaId);
    sendResponse(res, 200, true, "Asset synchronization processed", result);
  } catch (error) {
    next(error);
  }
};
