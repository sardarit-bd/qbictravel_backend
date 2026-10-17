import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as bookingService from "./bookingService.js";

export const createBooking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAgent = req.user!.role === "agent";
    const booking = await bookingService.createBooking(req.body, isAgent, req.user!.id);
    const status = booking.status === "AWAITING_APPROVAL" ? 202 : 201;
    sendResponse(res, status, true, "Booking created successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const updateBookingPrice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.updateAgentBookingPrice(
      req.params.bookingId as string,
      req.body,
      req.user!.id
    );
    sendResponse(res, 200, true, "Booking price updated successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const reviewBookingPrice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.reviewBookingPrice(
      req.params.bookingId as string,
      req.body,
      req.user!.id
    );
    sendResponse(res, 200, true, "Booking price reviewed successfully", booking);
  } catch (error) {
    next(error);
  }
};