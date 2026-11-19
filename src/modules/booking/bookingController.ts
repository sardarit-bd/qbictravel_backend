import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as bookingService from "./bookingService.js";
import { getAttributionFromRequest } from "../affiliate/affiliateAttribution.js";
import { affiliateService } from "../affiliate/affiliateService.js";
import { prisma } from "../../lib/prisma.js";

export const createBooking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAgent = req.user!.role === "agent";
    const booking = await bookingService.createBooking(req.body, isAgent, req.user!.id);

    // Attach server-validated last-click affiliate attribution ONLY for eligible customer bookings
    if (!isAgent && booking?.id && req.user!.role !== "admin" && req.user!.role !== "staff") {
      const attributionPayload = getAttributionFromRequest(req);
      const fallbackCode = typeof req.body?.referralCode === "string" ? req.body.referralCode : null;
      if (attributionPayload || fallbackCode) {
        try {
          await prisma.$transaction(async (tx) => {
            await affiliateService.attachAttributionToBooking(tx, {
              bookingId: booking.id,
              customerId: req.user!.id,
              attributionPayload,
              fallbackCode,
            });
          });
        } catch {
          // Non-blocking: never fail booking creation due to attribution
        }
      }
    }

    const status = booking.status === "AWAITING_APPROVAL" ? 202 : 201;
    sendResponse(res, status, true, "Booking created successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const createStaffBooking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.createStaffBooking(req.body, req.user!.id);
    sendResponse(res, 201, true, "Booking created successfully", booking);
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

export const listPendingReservations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await bookingService.listAdminPendingReservations(req.query);
    sendResponse(res, 200, true, "Pending reservations retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getPendingReservation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const booking = await bookingService.getAdminPendingReservation(req.params.bookingId as string);
    sendResponse(res, 200, true, "Pending reservation retrieved successfully", booking);
  } catch (error) {
    next(error);
  }
};

export const reviewPendingReservation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const updated = await bookingService.reviewPendingReservation(
      req.params.bookingId as string,
      req.body,
      req.user!.id
    );
    const message = req.body.action === "CONFIRM" ? "Booking confirmed successfully" : "Booking rejected successfully";
    sendResponse(res, 200, true, message, updated);
  } catch (error) {
    next(error);
  }
};

export const getAdminBookingHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await bookingService.getAdminBookingHistory(
      req.params.bookingId as string,
      req.query
    );
    sendResponse(res, 200, true, "Booking history retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getStaffBookingHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await bookingService.getStaffBookingHistory(
      req.user!.id,
      req.params.bookingId as string,
      req.query
    );
    sendResponse(res, 200, true, "Booking history retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getAgentBookingHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await bookingService.getAgentBookingHistory(
      req.user!.id,
      req.params.bookingId as string,
      req.query
    );
    sendResponse(res, 200, true, "Booking history retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const listStaffCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await bookingService.listStaffCustomers(req.query);
    sendResponse(res, 200, true, "Staff customers retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const listStaffCreatedBookings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await bookingService.listStaffCreatedBookings(req.user!.id, req.query);
    sendResponse(res, 200, true, "Staff created bookings retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

