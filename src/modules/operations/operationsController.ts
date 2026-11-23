import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as operationsService from "./operationsService.js";

export const getOperationsSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const actorRole = (req.user?.role || "staff") as "staff" | "admin";
    const actorId = req.user!.id;
    const result = await operationsService.getOperationsSchedule(actorRole, actorId, req.query);
    sendResponse(res, 200, true, "Operations schedule retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const exportSchedulePdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const actorRole = (req.user?.role || "staff") as "staff" | "admin";
    const actorId = req.user!.id;
    const { pdfBuffer, filename } = await operationsService.exportSchedulePdf(actorRole, actorId, req.query);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

export const exportDailyManifestPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const actorRole = (req.user?.role || "staff") as "staff" | "admin";
    const actorId = req.user!.id;
    const { pdfBuffer, filename } = await operationsService.exportDailyManifestPdf(actorRole, actorId, req.query);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.status(200).send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

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
    sendResponse(res, 200, true, "Fulfillment status corrected successfully", booking);
  } catch (error) {
    next(error);
  }
};
