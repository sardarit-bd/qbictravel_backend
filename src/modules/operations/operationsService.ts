import AppError from "../../shared/utils/AppError.js";
import { parseEnumQuery, parsePagination, parseUuidQuery } from "../../shared/utils/pagination.js";
import * as operationsRepository from "./operationsRepository.js";
import { FULFILLMENT_STATUSES } from "./operationsTypes.js";
import type {
  AssignBookingInput,
  FulfillmentStatusValue,
  OperationalActorRole,
  OperationalBookingStatus,
  OperationalFilters,
  UpdateOperationalStatusInput,
} from "./operationsTypes.js";

interface Transition {
  from: FulfillmentStatusValue;
  to: FulfillmentStatusValue;
  bookingFrom: OperationalBookingStatus;
  bookingTo: OperationalBookingStatus;
  adminOnly: boolean;
  requiresPaid: boolean;
}

export const TRANSITIONS: Transition[] = [
  { from: "NOT_STARTED", to: "IN_PROGRESS", bookingFrom: "CONFIRMED", bookingTo: "IN_PROGRESS", adminOnly: false, requiresPaid: false },
  { from: "IN_PROGRESS", to: "FULFILLED", bookingFrom: "IN_PROGRESS", bookingTo: "COMPLETED", adminOnly: false, requiresPaid: true },
  { from: "IN_PROGRESS", to: "NOT_STARTED", bookingFrom: "IN_PROGRESS", bookingTo: "CONFIRMED", adminOnly: true, requiresPaid: false },
  { from: "FULFILLED", to: "IN_PROGRESS", bookingFrom: "COMPLETED", bookingTo: "IN_PROGRESS", adminOnly: true, requiresPaid: false },
];

const listWithFilters = async (base: OperationalFilters, query: Record<string, unknown>) => {
  const { page, limit, skip } = parsePagination(query);
  const filters: OperationalFilters = {
    ...base,
    fulfillmentStatus: parseEnumQuery(query.fulfillmentStatus, FULFILLMENT_STATUSES, "fulfillmentStatus"),
  };
  const { items, total } = await operationsRepository.listOperationalBookings(filters, skip, limit);
  return { items, page, limit, total };
};

export const listStaffBookings = async (staffId: string, query: Record<string, unknown>) =>
  listWithFilters({ assignedStaffId: staffId }, query);

export const getStaffBooking = async (staffId: string, bookingId: string) => {
  const booking = await operationsRepository.findOperationalBooking(bookingId, staffId);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }
  return booking;
};

export const listAdminBookings = async (query: Record<string, unknown>) =>
  listWithFilters({ assignedStaffId: parseUuidQuery(query.assignedStaffId, "assignedStaffId") }, query);

export const updateOperationalStatus = async (
  actorRole: OperationalActorRole,
  actorId: string,
  bookingId: string,
  input: UpdateOperationalStatusInput,
) => {
  const booking = await operationsRepository.findBookingForTransition(bookingId);

  if (!booking || (actorRole === "staff" && booking.assignedStaffId !== actorId)) {
    throw new AppError("Booking not found", 404);
  }

  if (booking.fulfillmentStatus === input.fulfillmentStatus) {
    throw new AppError("The booking is already in this fulfillment status", 409);
  }

  const transition = TRANSITIONS.find(
    (t) => t.from === booking.fulfillmentStatus && t.to === input.fulfillmentStatus,
  );

  if (!transition) {
    throw new AppError(
      `Cannot move fulfillment from ${booking.fulfillmentStatus} to ${input.fulfillmentStatus}`,
      409,
    );
  }

  if (transition.adminOnly && actorRole !== "admin") {
    throw new AppError("Only an administrator can make this correction", 403);
  }

  if (booking.status !== transition.bookingFrom) {
    throw new AppError(`A booking with status ${booking.status} cannot make this change`, 409);
  }

  if (transition.requiresPaid && booking.paymentStatus !== "PAID") {
    throw new AppError("Payment must be verified before the booking can be completed", 409);
  }

  const updated = await operationsRepository.applyOperationalTransition({
    bookingId,
    actorId,
    actorRole,
    from: transition.from,
    to: transition.to,
    bookingFrom: transition.bookingFrom,
    bookingTo: transition.bookingTo,
    requireAssignedTo: actorRole === "staff" ? actorId : undefined,
    requirePaid: transition.requiresPaid,
    action: transition.adminOnly ? "OPERATIONS_STATUS_CORRECTED" : "OPERATIONS_STATUS_UPDATED",
    changes: {
      previousFulfillmentStatus: transition.from,
      newFulfillmentStatus: transition.to,
      previousBookingStatus: transition.bookingFrom,
      newBookingStatus: transition.bookingTo,
      notes: input.notes ?? null,
    },
  });

  if (!updated) {
    throw new AppError("The booking was changed by someone else. Please reload and retry.", 409);
  }

  return updated;
};

export const assignBooking = async (adminId: string, bookingId: string, input: AssignBookingInput) => {
  const booking = await operationsRepository.findBookingForTransition(bookingId);

  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  if (input.staffId) {
    const staff = await operationsRepository.findActiveStaff(input.staffId);
    if (!staff) {
      throw new AppError("Staff user not found or inactive", 400);
    }
  }

  const updated = await operationsRepository.applyAssignment({
    bookingId,
    staffId: input.staffId,
    adminId,
    changes: {
      previousStaffId: booking.assignedStaffId,
      newStaffId: input.staffId,
      notes: input.notes ?? null,
    },
  });

  if (!updated) {
    throw new AppError("This booking can no longer be reassigned", 409);
  }

  return updated;
};