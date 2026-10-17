import { Router } from "express";
import * as bookingController from "./bookingController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  createBookingSchema,
  updateBookingPriceSchema,
  reviewBookingPriceSchema,
  bookingIdParamSchema,
} from "./bookingValidators.js";

const router = Router();

// Customer Routes
router.post(
  "/bookings",
  authMiddleware,
  requireRole("customer"),
  validate(createBookingSchema),
  bookingController.createBooking
);

// Agent Routes
router.post(
  "/agent/bookings",
  authMiddleware,
  requireRole("agent"),
  validate(createBookingSchema),
  bookingController.createBooking
);

router.patch(
  "/agent/bookings/:bookingId/price",
  authMiddleware,
  requireRole("agent"),
  validate(bookingIdParamSchema, "params"),
  validate(updateBookingPriceSchema),
  bookingController.updateBookingPrice
);

// Admin Routes
router.post(
  "/admin/bookings/:bookingId/price-approvals",
  authMiddleware,
  requireRole("admin"),
  validate(bookingIdParamSchema, "params"),
  validate(reviewBookingPriceSchema),
  bookingController.reviewBookingPrice
);

export default router;