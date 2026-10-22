import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as operationsService from "./operationsService.js";

export const listStaffBookings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await operationsService.listStaffBookings(req.user!.id, req.query);
    sendResponse(res, 200, true, "Operational bookings retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getStaffBooking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await operationsService.getStaffBooking(req.user!.id, req.params.bookingId as string);
    sendResponse(res, 200, true, "Operational booking retrieved successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const updateStaffBookingStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await operationsService.updateOperationalStatus(
      "staff",
      req.user!.id,
      req.params.bookingId as string,
      req.body,
    );
    sendResponse(res, 200, true, "Fulfillment status updated successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const listAdminBookings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await operationsService.listAdminBookings(req.query);
    sendResponse(res, 200, true, "Operational bookings retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const assignBooking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await operationsService.assignBooking(
      req.user!.id,
      req.params.bookingId as string,
      req.body,
    );
    sendResponse(res, 200, true, "Booking assignment updated successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const updateAdminBookingStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await operationsService.updateOperationalStatus(
      "admin",
      req.user!.id,
      req.params.bookingId as string,
      req.body,
    );
    sendResponse(res, 200, true, "Fulfillment status updated successfully", booking);
  } catch (error) {
    next(error);
  }
};