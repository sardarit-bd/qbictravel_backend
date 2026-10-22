import * as yup from "yup";
import { FULFILLMENT_STATUSES } from "./operationsTypes.js";

export const operationsBookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("Booking ID is required"),
});

export const updateOperationalStatusSchema = yup.object({
  fulfillmentStatus: yup
    .string()
    .oneOf([...FULFILLMENT_STATUSES], "Invalid fulfillment status")
    .required("Fulfillment status is required"),
  notes: yup.string().trim().max(500, "Notes must be at most 500 characters").optional(),
});

export const adminUpdateOperationalStatusSchema = yup.object({
  fulfillmentStatus: yup
    .string()
    .oneOf([...FULFILLMENT_STATUSES], "Invalid fulfillment status")
    .required("Fulfillment status is required"),
  notes: yup
    .string()
    .trim()
    .min(3, "Notes are too short")
    .max(500, "Notes must be at most 500 characters")
    .required("Notes are required for administrative status changes"),
});

export const assignBookingSchema = yup.object({
  staffId: yup.string().uuid("Invalid staff ID").nullable().defined("staffId is required (use null to unassign)"),
  notes: yup.string().trim().max(500, "Notes must be at most 500 characters").optional(),
});