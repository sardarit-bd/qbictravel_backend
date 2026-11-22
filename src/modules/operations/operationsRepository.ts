import { prisma } from "../../lib/prisma.js";
import type { FulfillmentStatusValue, OperationalBookingStatus, OperationalFilters } from "./operationsTypes.js";

type HistoryChanges = Record<string, string | number | boolean | null>;

const OPERATIONAL_BOOKING_STATUSES: OperationalBookingStatus[] = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"];
const CLOSED_BOOKING_STATUSES: ("COMPLETED" | "CANCELLED" | "FAILED")[] = ["COMPLETED", "CANCELLED", "FAILED"];

export const staffOperationalSelect = {
  id: true,
  status: true,
  fulfillmentStatus: true,
  paymentStatus: true,
  source: true,
  agentId: true,
  createdById: true,
  assignedStaffId: true,
  notes: true,
  internalNotes: true,
  createdAt: true,
  updatedAt: true,
  service: { select: { id: true, name: true, type: true } },
  availability: { select: { id: true, date: true } },
  customer: { select: { id: true, name: true, phone: true } },
  assignedStaff: { select: { id: true, name: true } },
  agent: {
    select: {
      id: true,
      name: true,
      email: true,
      agentProfile: {
        select: {
          agencyName: true,
        },
      },
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      role: true,
    },
  },
  discountRequests: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      discountType: true,
      discountValue: true,
      originalPrice: true,
      discountAmount: true,
      proposedFinalPrice: true,
      approvedDiscountAmount: true,
      approvedFinalPrice: true,
      status: true,
      reason: true,
      rejectionReason: true,
      adminNotes: true,
      requestedById: true,
      reviewedById: true,
      reviewedAt: true,
      createdAt: true,
      requestedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  },
} as const;

export const adminOperationalSelect = {
  ...staffOperationalSelect,
  currency: true,
  basePrice: true,
  proposedPrice: true,
  finalPrice: true,
} as const;

// Backward compatibility alias for staff projection
const operationalSelect = staffOperationalSelect;

export const listOperationalBookings = async (
  filters: OperationalFilters,
  skip: number,
  take: number,
  projection: "admin" | "staff" = "staff"
) => {
  const where: any = {
    status: { in: OPERATIONAL_BOOKING_STATUSES },
    ...(filters.assignedStaffId ? { assignedStaffId: filters.assignedStaffId } : {}),
    ...(filters.fulfillmentStatus ? { fulfillmentStatus: filters.fulfillmentStatus } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.createdById ? { createdById: filters.createdById } : {}),
    ...(filters.source ? { source: filters.source } : {}),
  };

  const select = projection === "admin" ? adminOperationalSelect : staffOperationalSelect;

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, total };
};

export const findOperationalBooking = async (
  bookingId: string,
  assignedStaffId?: string,
  projection: "admin" | "staff" = "staff"
) => {
  const select = projection === "admin" ? adminOperationalSelect : staffOperationalSelect;

  return prisma.booking.findFirst({
    where: {
      id: bookingId,
      status: { in: OPERATIONAL_BOOKING_STATUSES },
      ...(assignedStaffId ? { assignedStaffId } : {}),
    },
    select,
  });
};

export const findBookingForTransition = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      paymentStatus: true,
      assignedStaffId: true,
      createdById: true,
      assignedStaff: { select: { id: true, name: true } },
    },
  });
};

export const findActiveStaff = async (staffId: string) => {
  return prisma.user.findFirst({
    where: { id: staffId, role: "staff", status: "active" },
    select: { id: true, name: true },
  });
};

export const applyOperationalTransition = async (params: {
  bookingId: string;
  actorId: string;
  actorRole: "staff" | "admin";
  from: FulfillmentStatusValue;
  to: FulfillmentStatusValue;
  bookingFrom: OperationalBookingStatus;
  bookingTo: OperationalBookingStatus;
  requireAssignedTo?: string;
  requirePaid: boolean;
  action: string;
  changes: HistoryChanges;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.booking.updateMany({
      where: {
        id: params.bookingId,
        fulfillmentStatus: params.from,
        status: params.bookingFrom,
        ...(params.requireAssignedTo ? { assignedStaffId: params.requireAssignedTo } : {}),
        ...(params.requirePaid ? { paymentStatus: "PAID" } : {}),
      },
      data: { fulfillmentStatus: params.to, status: params.bookingTo },
    });

    if (updated.count === 0) {
      return null;
    }

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: params.action,
        changes: params.changes,
      },
    });

    const select = params.actorRole === "admin" ? adminOperationalSelect : staffOperationalSelect;

    return tx.booking.findUniqueOrThrow({
      where: { id: params.bookingId },
      select,
    });
  });
};

export const applyAssignment = async (params: {
  bookingId: string;
  staffId: string | null;
  adminId: string;
  changes: HistoryChanges;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.booking.updateMany({
      where: { id: params.bookingId, status: { notIn: CLOSED_BOOKING_STATUSES } },
      data: { assignedStaffId: params.staffId },
    });

    if (updated.count === 0) {
      return null;
    }

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.adminId,
        actorRole: "admin",
        action: params.staffId ? "OPERATIONS_ASSIGNED" : "OPERATIONS_UNASSIGNED",
        changes: params.changes,
      },
    });

    return tx.booking.findUniqueOrThrow({
      where: { id: params.bookingId },
      select: adminOperationalSelect,
    });
  });
};

/**
 * Query bookings for the Operations Schedule and Daily Manifest
 */
export const queryScheduleBookings = async (params: {
  startDate: Date;
  endDate: Date;
  serviceId?: string;
  bookingStatus?: string;
  fulfillmentStatus?: FulfillmentStatusValue;
  search?: string;
  actorRole: "staff" | "admin";
  actorId: string;
}) => {
  const where: any = {
    // Exclude permanently failed or draft bookings, but include operational & confirmed ones
    status: params.bookingStatus
      ? params.bookingStatus
      : { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "PENDING"] },
  };

  if (params.fulfillmentStatus) {
    where.fulfillmentStatus = params.fulfillmentStatus;
  }

  if (params.serviceId) {
    where.serviceId = params.serviceId;
  }

  const andConditions: any[] = [];

  // Date filtering: Match bookings whose availability.date falls in the window
  // OR bookings whose notes contain the travel date in the window
  andConditions.push({
    OR: [
      {
        availability: {
          date: {
            gte: params.startDate,
            lte: params.endDate,
          },
        },
      },
      // Also include bookings created in the range if availability is open/unlinked
      {
        availabilityId: null,
        createdAt: {
          gte: params.startDate,
          lte: params.endDate,
        },
      },
    ],
  });

  // Staff booking visibility policy:
  // Staff can only view bookings where they are assigned (assignedStaffId === actorId)
  // OR where they created the booking (createdById === actorId).
  // If actorRole is not admin, a valid non-empty actorId is strictly required.
  if (params.actorRole !== "admin") {
    if (!params.actorId || typeof params.actorId !== "string" || !params.actorId.trim()) {
      // Safe guard: Staff request without a valid authenticated actorId must match nothing
      andConditions.push({ id: "__UNAUTHORIZED_STAFF_MISSING_ACTOR_ID__" });
    } else {
      andConditions.push({
        OR: [
          { assignedStaffId: params.actorId.trim() },
          { createdById: params.actorId.trim() },
        ],
      });
    }
  }

  if (params.search) {
    const term = params.search.trim();
    andConditions.push({
      OR: [
        { id: { contains: term, mode: "insensitive" } },
        { service: { name: { contains: term, mode: "insensitive" } } },
        { customer: { name: { contains: term, mode: "insensitive" } } },
        { customer: { email: { contains: term, mode: "insensitive" } } },
        { notes: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  where.AND = andConditions;

  return prisma.booking.findMany({
    where,
    select: {
      id: true,
      status: true,
      fulfillmentStatus: true,
      paymentStatus: true,
      source: true,
      notes: true,
      internalNotes: true,
      createdAt: true,
      service: {
        select: {
          id: true,
          name: true,
          type: true,
          metadata: true,
          availability: {
            where: {
              date: {
                gte: params.startDate,
                lte: params.endDate,
              },
            },
            select: {
              id: true,
              date: true,
              capacity: true,
              bookedCount: true,
            },
          },
        },
      },
      availability: {
        select: {
          id: true,
          date: true,
          capacity: true,
          bookedCount: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      assignedStaff: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [
      { createdAt: "asc" },
    ],
  });
};
