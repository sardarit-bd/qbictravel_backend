import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as customerService from "./customerService.js";

export const listBookings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await customerService.listCustomerBookings(
      req.user!.id,
      req.query
    );
    sendResponse(res, 200, true, "Bookings retrieved successfully", result);
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
    const booking = await customerService.getCustomerBooking(
      req.user!.id,
      req.params.bookingId as string
    );
    sendResponse(res, 200, true, "Booking retrieved successfully", booking);
  } catch (error) {
    next(error);
  }
};
