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
  OperationsScheduleGroup,
  OperationsScheduleItem,
  OperationsScheduleResponse,
  UpdateOperationalStatusInput,
} from "./operationsTypes.js";
import * as notificationService from "../notification/notificationService.js";
import { emitBookingEvent } from "../event/eventEmitter.js";
import logger from "../../shared/logger/logger.js";

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

/**
 * Helper to safely parse structured booking notes
 */
export function parseNotesMetadata(rawNotes?: string | null): {
  travelDate: string | null;
  departureTime: string | null;
  adults: number;
  children: number;
  infants: number;
  pickupLocation: string | null;
  specialInstructions: string | null;
} {
  const result = {
    travelDate: null as string | null,
    departureTime: null as string | null,
    adults: 1,
    children: 0,
    infants: 0,
    pickupLocation: null as string | null,
    specialInstructions: null as string | null,
  };

  if (!rawNotes || typeof rawNotes !== "string") {
    return result;
  }

  const parts = rawNotes.split(" | ");
  const customRequests: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (/^Travel Date:\s*/i.test(trimmed)) {
      result.travelDate = trimmed.replace(/^Travel Date:\s*/i, "").trim();
    } else if (/^Departure:\s*/i.test(trimmed)) {
      result.departureTime = trimmed.replace(/^Departure:\s*/i, "").trim();
    } else if (/^Guests:\s*/i.test(trimmed)) {
      const guestText = trimmed.replace(/^Guests:\s*/i, "").trim();
      const adultsMatch = guestText.match(/(\d+)\s*Adult/i);
      const childrenMatch = guestText.match(/(\d+)\s*Child/i);
      const infantsMatch = guestText.match(/(\d+)\s*Infant/i);

      if (adultsMatch) result.adults = parseInt(adultsMatch[1], 10);
      if (childrenMatch) result.children = parseInt(childrenMatch[1], 10);
      if (infantsMatch) result.infants = parseInt(infantsMatch[1], 10);
    } else if (/^Pickup:\s*/i.test(trimmed) || /^Hotel:\s*/i.test(trimmed)) {
      result.pickupLocation = trimmed.replace(/^(Pickup|Hotel):\s*/i, "").trim();
    } else if (/^Contact:\s*/i.test(trimmed)) {
      // Skip contact part from notes
    } else if (/^(Notes|Special requests|Special instructions):\s*/i.test(trimmed)) {
      const noteClean = trimmed.replace(/^(Notes|Special requests|Special instructions):\s*/i, "").trim();
      if (noteClean) customRequests.push(noteClean);
    } else {
      customRequests.push(trimmed);
    }
  }

  if (customRequests.length > 0) {
    result.specialInstructions = customRequests.join(" • ");
  }

  return result;
}

const listWithFilters = async (
  base: OperationalFilters,
  query: Record<string, unknown>,
  projection: "admin" | "staff" = "staff"
) => {
  const { page, limit, skip } = parsePagination(query);
  const filters: OperationalFilters = {
    ...base,
    fulfillmentStatus: parseEnumQuery(query.fulfillmentStatus, FULFILLMENT_STATUSES, "fulfillmentStatus"),
  };
  const { items, total } = await operationsRepository.listOperationalBookings(filters, skip, limit, projection);
  return { items, page, limit, total };
};

export const listStaffBookings = async (staffId: string, query: Record<string, unknown>) =>
  listWithFilters({ assignedStaffId: staffId }, query, "staff");

export const getStaffBooking = async (staffId: string, bookingId: string) => {
  const booking = await operationsRepository.findOperationalBooking(bookingId, staffId, "staff");
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }
  return booking;
};

export const listAdminBookings = async (query: Record<string, unknown>) =>
  listWithFilters(
    {
      assignedStaffId: parseUuidQuery(query.assignedStaffId, "assignedStaffId"),
      agentId: parseUuidQuery(query.agentId, "agentId"),
      createdById: parseUuidQuery(query.createdById, "createdById"),
      source: query.source as any,
    },
    query,
    "admin"
  );

export const updateOperationalStatus = async (
  actorRole: OperationalActorRole,
  actorId: string,
  bookingId: string,
  input: UpdateOperationalStatusInput,
) => {
  const booking = await operationsRepository.findBookingForTransition(bookingId);

  // Staff can update fulfillment status for bookings assigned to them OR created by them
  if (
    !booking ||
    (actorRole === "staff" &&
      booking.assignedStaffId &&
      booking.assignedStaffId !== actorId &&
      booking.createdById !== actorId)
  ) {
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
    requireAssignedTo: actorRole === "staff" && booking.assignedStaffId === actorId ? actorId : undefined,
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

  await notificationService.notifyOperationalUpdate(bookingId);

  const eventType = transition.bookingTo === "COMPLETED" ? "booking.completed" : "booking.status_changed";
  emitBookingEvent(eventType, bookingId, {
    fulfillmentStatus: transition.to,
    status: transition.bookingTo,
  }).catch((err) =>
    logger.error({ bookingId, err }, "Failed to emit operational update event")
  );

  return updated;
};

export const assignBooking = async (
  adminId: string,
  bookingId: string,
  input: AssignBookingInput,
) => {
  const booking = await operationsRepository.findBookingForTransition(bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  const staffUser = input.staffId
    ? await operationsRepository.findActiveStaff(input.staffId)
    : null;

  if (input.staffId && !staffUser) {
    throw new AppError("Staff user not found or inactive", 400);
  }

  const updated = await operationsRepository.applyAssignment({
    bookingId,
    staffId: input.staffId,
    adminId,
    changes: {
      previousStaffId: booking.assignedStaffId,
      previousStaffName: booking.assignedStaff?.name ?? null,
      newStaffId: input.staffId,
      newStaffName: staffUser?.name ?? null,
      notes: input.notes ?? null,
    },
  });

  if (!updated) {
    throw new AppError("Cannot reassign a closed booking", 409);
  }

  if (input.staffId) {
    const notifyPromise = notificationService.notifyStaffAssignment(bookingId, input.staffId);
    if (notifyPromise && typeof notifyPromise.catch === "function") {
      notifyPromise.catch((err) =>
        logger.error({ bookingId, staffId: input.staffId, err }, "Failed to dispatch staff assignment notification")
      );
    }
  }

  return updated;
};

/**
 * Get Operations Schedule and Manifest
 * Groups confirmed & operational bookings by Travel Date, Tour Service, and Departure Time.
 */
export const getOperationsSchedule = async (
  actorRole: "staff" | "admin",
  actorId: string,
  query: Record<string, unknown>
): Promise<OperationsScheduleResponse> => {
  // Default window: Today until 7 days ahead
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const defaultEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const defaultEndStr = defaultEnd.toISOString().split("T")[0];

  const startDateStr = (query.startDate as string) || todayStr;
  const endDateStr = (query.endDate as string) || defaultEndStr;

  const startParsed = new Date(`${startDateStr}T00:00:00.000Z`);
  const endParsed = new Date(`${endDateStr}T23:59:59.999Z`);

  if (isNaN(startParsed.getTime()) || isNaN(endParsed.getTime())) {
    throw new AppError("Invalid date format. Expected YYYY-MM-DD", 400);
  }

  const bookings = await operationsRepository.queryScheduleBookings({
    startDate: startParsed,
    endDate: endParsed,
    serviceId: query.serviceId as string | undefined,
    bookingStatus: query.bookingStatus as string | undefined,
    fulfillmentStatus: query.fulfillmentStatus !== "ALL" ? (query.fulfillmentStatus as FulfillmentStatusValue) : undefined,
    search: query.search as string | undefined,
    actorRole,
    actorId,
  });

  // Group by (Travel Date + Service ID + Departure Time)
  const groupMap = new Map<string, OperationsScheduleGroup>();
  let overallTotalBookings = 0;
  let overallTotalPassengers = 0;

  for (const b of bookings) {
    const parsed = parseNotesMetadata(b.notes);

    // Resolve effective travel date
    let travelDate = "";
    if (b.availability?.date) {
      travelDate = new Date(b.availability.date).toISOString().split("T")[0];
    } else if (parsed.travelDate) {
      travelDate = parsed.travelDate;
    } else {
      travelDate = new Date(b.createdAt).toISOString().split("T")[0];
    }

    // Check if within window
    if (travelDate < startDateStr || travelDate > endDateStr) {
      continue;
    }

    const departureTime = parsed.departureTime || null;
    const hasDepartureTime = Boolean(departureTime);

    const totalPax = Math.max(1, parsed.adults + parsed.children + parsed.infants);

    const item: OperationsScheduleItem = {
      id: b.id,
      reference: `#${b.id.slice(0, 8)}`,
      bookingRef: `#${b.id.slice(0, 8)}`,
      serviceId: b.service.id,
      serviceName: b.service.name,
      serviceTitle: b.service.name,
      serviceType: b.service.type,
      travelDate,
      departureTime,
      hasDepartureTime,
      customerName: b.customer?.name || "Customer",
      customerEmail: b.customer?.email || null,
      customerPhone: b.customer?.phone || null,
      adults: parsed.adults,
      children: parsed.children,
      infants: parsed.infants,
      totalPassengers: totalPax,
      totalGuests: totalPax,
      pickupLocation: parsed.pickupLocation,
      specialInstructions: parsed.specialInstructions,
      bookingStatus: b.status,
      paymentStatus: b.paymentStatus,
      fulfillmentStatus: b.fulfillmentStatus as FulfillmentStatusValue,
      assignedStaffName: b.assignedStaff?.name || null,
      source: b.source,
    };

    overallTotalBookings += 1;
    overallTotalPassengers += totalPax;

    // Group key
    const depKey = departureTime ? departureTime.toLowerCase().replace(/\s+/g, "") : "unscheduled";
    const groupKey = `${travelDate}__${b.service.id}__${depKey}`;

    if (!groupMap.has(groupKey)) {
      // Find capacity for this service on this date
      const avail = b.service.availability?.find((a: any) => {
        const dStr = new Date(a.date).toISOString().split("T")[0];
        return dStr === travelDate;
      }) || b.availability;

      let capacityObj: OperationsScheduleGroup["capacity"] = null;
      if (avail && avail.capacity !== null && avail.capacity !== undefined) {
        const booked = avail.bookedCount ?? 0;
        capacityObj = {
          total: avail.capacity,
          bookedCount: booked,
          remaining: Math.max(0, avail.capacity - booked),
        };
      }

      groupMap.set(groupKey, {
        travelDate,
        serviceId: b.service.id,
        serviceName: b.service.name,
        serviceTitle: b.service.name,
        serviceType: b.service.type,
        departureTime,
        hasDepartureTime,
        totalBookings: 0,
        totalPassengers: 0,
        totalAdults: 0,
        totalChildren: 0,
        totalInfants: 0,
        capacity: capacityObj,
        pickupSummary: {
          locationsCount: 0,
          locations: [],
        },
        pickupLocations: [],
        fulfillmentCounts: {
          notStarted: 0,
          inProgress: 0,
          fulfilled: 0,
        },
        bookings: [],
      });
    }

    const group = groupMap.get(groupKey)!;
    group.totalBookings += 1;
    group.totalPassengers += totalPax;
    group.totalAdults += parsed.adults;
    group.totalChildren += parsed.children;
    group.totalInfants += parsed.infants;

    if (item.fulfillmentStatus === "NOT_STARTED") group.fulfillmentCounts.notStarted += 1;
    if (item.fulfillmentStatus === "IN_PROGRESS") group.fulfillmentCounts.inProgress += 1;
    if (item.fulfillmentStatus === "FULFILLED") group.fulfillmentCounts.fulfilled += 1;

    if (parsed.pickupLocation && !group.pickupSummary.locations.includes(parsed.pickupLocation)) {
      group.pickupSummary.locations.push(parsed.pickupLocation);
      group.pickupSummary.locationsCount = group.pickupSummary.locations.length;
      group.pickupLocations = group.pickupSummary.locations;
    }

    group.bookings.push(item);
  }

  // Convert map to sorted array (sorted by travelDate asc, serviceName asc, departureTime asc)
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.travelDate !== b.travelDate) return a.travelDate.localeCompare(b.travelDate);
    if (a.serviceName !== b.serviceName) return a.serviceName.localeCompare(b.serviceName);
    if (a.departureTime && b.departureTime) return a.departureTime.localeCompare(b.departureTime);
    if (a.departureTime) return -1;
    if (b.departureTime) return 1;
    return 0;
  });

  return {
    startDate: startDateStr,
    endDate: endDateStr,
    totalGroups: groups.length,
    totalBookings: overallTotalBookings,
    totalPassengers: overallTotalPassengers,
    groups,
  };
};
