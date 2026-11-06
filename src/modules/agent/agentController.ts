import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as agentService from "./agentService.js";

export const getOverview = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const metrics = await agentService.getAgentOverview(req.user!.id);
    sendResponse(res, 200, true, "Agent overview retrieved successfully", metrics);
  } catch (error) {
    next(error);
  }
};

export const listBookings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await agentService.listAgentBookings(req.user!.id, req.query);
    sendResponse(res, 200, true, "Agent bookings retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getBooking = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const booking = await agentService.getAgentBooking(
      req.user!.id,
      req.params.bookingId as string
    );
    sendResponse(res, 200, true, "Agent booking retrieved successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const profile = await agentService.getAgentProfile(req.user!.id);
    sendResponse(res, 200, true, "Agent profile retrieved successfully", profile);
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const updated = await agentService.updateAgentProfile(req.user!.id, req.body);
    sendResponse(res, 200, true, "Agent profile updated successfully", updated);
  } catch (error) {
    next(error);
  }
};
