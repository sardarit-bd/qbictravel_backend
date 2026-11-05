import AppError from "../../shared/utils/AppError.js";
import * as customerRepository from "./customerRepository.js";
import type { ListCustomerBookingsParams } from "./customerRepository.js";

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
