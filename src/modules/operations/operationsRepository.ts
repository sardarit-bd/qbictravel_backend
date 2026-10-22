import { prisma } from "../../lib/prisma.js";
import type { FulfillmentStatusValue, OperationalBookingStatus, OperationalFilters } from "./operationsTypes.js";

type HistoryChanges = Record<string, string | number | boolean | null>;

const OPERATIONAL_BOOKING_STATUSES: OperationalBookingStatus[] = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"];
const CLOSED_BOOKING_STATUSES: ("COMPLETED" | "CANCELLED" | "FAILED")[] = ["COMPLETED", "CANCELLED", "FAILED"];

const operationalSelect = {
  id: true,
  status: true,
  fulfillmentStatus: true,
  paymentStatus: true,
  assignedStaffId: true,
  notes: true,
  internalNotes: true,
  createdAt: true,
  updatedAt: true,
  service: { select: { id: true, name: true, type: true } },
  availability: { select: { id: true, date: true } },
  customer: { select: { id: true, name: true, phone: true } },
  assignedStaff: { select: { id: true, name: true } },
} as const;

export const listOperationalBookings = async (filters: OperationalFilters, skip: number, take: number) => {
  const where = {
    status: { in: OPERATIONAL_BOOKING_STATUSES },
    ...(filters.assignedStaffId ? { assignedStaffId: filters.assignedStaffId } : {}),
    ...(filters.fulfillmentStatus ? { fulfillmentStatus: filters.fulfillmentStatus } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: operationalSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, total };
};

export const findOperationalBooking = async (bookingId: string, assignedStaffId?: string) => {
  return prisma.booking.findFirst({
    where: {
      id: bookingId,
      status: { in: OPERATIONAL_BOOKING_STATUSES },
      ...(assignedStaffId ? { assignedStaffId } : {}),
    },
    select: operationalSelect,
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

    return tx.booking.findUniqueOrThrow({
      where: { id: params.bookingId },
      select: operationalSelect,
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
      select: operationalSelect,
    });
  });
};