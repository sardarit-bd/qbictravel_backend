import AppError from "../../shared/utils/AppError.js";
import * as customerRepository from "./customerRepository.js";
import type { ListCustomerBookingsParams } from "./customerRepository.js";
import * as bookingClaimService from "./bookingClaimService.js";

export const listCustomerBookings = async (
  customerId: string,
  params: ListCustomerBookingsParams
) => {
  return customerRepository.listCustomerBookings(customerId, params);
};

export const getCustomerBooking = async (
  customerId: string,
  bookingId: string
) => {
  const booking = await customerRepository.findCustomerBookingById(
    customerId,
    bookingId
  );
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }
  return booking;
};

export const claimGuestBookingByToken = async (
  userId: string,
  userEmail: string,
  rawToken: string,
  context?: { ipAddress?: string; userAgent?: string }
) => {
  return bookingClaimService.claimGuestBookingByToken(
    userId,
    userEmail,
    rawToken,
    context
  );
};

export const getUnclaimedGuestBookings = async (
  userId: string,
  userEmail: string
) => {
  return bookingClaimService.findUnclaimedGuestBookingsByEmail(
    userEmail,
    userId
  );
};

export const claimAllGuestBookings = async (
  userId: string,
  userEmail: string,
  context?: { ipAddress?: string; userAgent?: string }
) => {
  return bookingClaimService.claimGuestBookingsForUser(
    userId,
    userEmail,
    "MANUAL_BATCH",
    context
  );
};
