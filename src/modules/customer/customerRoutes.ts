import { Router } from "express";
import * as customerController from "./customerController.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import validate from "../../shared/middleware/validate.js";
import {
  bookingIdParamSchema,
  claimBookingByTokenSchema,
} from "./customerValidators.js";

const router = Router();

// Protect all customer routes with auth and customer/affiliate role (blocks agent, staff, admin).
router.use("/customer", authMiddleware, requireRole("customer", "affiliate"));

/**
 * @openapi
 * /api/v1/customer/bookings:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Retrieve paginated bookings owned by the authenticated customer
 */
router.get("/customer/bookings", customerController.listBookings);

/**
 * @openapi
 * /api/v1/customer/bookings/unclaimed:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Retrieve unclaimed guest bookings matching the authenticated customer's email
 */
router.get("/customer/bookings/unclaimed", customerController.getUnclaimedBookings);

/**
 * @openapi
 * /api/v1/customer/bookings/claim:
 *   post:
 *     tags: [Customer Portal]
 *     summary: Claim a guest booking using a magic-link access token
 */
router.post(
  "/customer/bookings/claim",
  validate(claimBookingByTokenSchema, "body"),
  customerController.claimBookingByToken
);

/**
 * @openapi
 * /api/v1/customer/bookings/claim-all:
 *   post:
 *     tags: [Customer Portal]
 *     summary: Claim all unclaimed guest bookings matching the customer's email
 */
router.post("/customer/bookings/claim-all", customerController.claimAllBookings);

/**
 * @openapi
 * /api/v1/customer/bookings/{bookingId}:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Retrieve a single booking owned by the authenticated customer
 */
router.get(
  "/customer/bookings/:bookingId",
  validate(bookingIdParamSchema, "params"),
  customerController.getBooking
);

export default router;
