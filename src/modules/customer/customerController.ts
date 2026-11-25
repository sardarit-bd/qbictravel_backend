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

export const claimBookingByToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.body;
    const clientContext = {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    };
    const result = await customerService.claimGuestBookingByToken(
      req.user!.id,
      req.user!.email,
      token,
      clientContext
    );
    sendResponse(res, 200, true, "Booking claimed successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getUnclaimedBookings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const bookings = await customerService.getUnclaimedGuestBookings(
      req.user!.id,
      req.user!.email
    );
    sendResponse(res, 200, true, "Unclaimed guest bookings retrieved", bookings);
  } catch (error) {
    next(error);
  }
};

export const claimAllBookings = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const clientContext = {
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.get("user-agent"),
    };
    const result = await customerService.claimAllGuestBookings(
      req.user!.id,
      req.user!.email,
      clientContext
    );
    sendResponse(res, 200, true, "Guest bookings claimed successfully", result);
  } catch (error) {
    next(error);
  }
};
