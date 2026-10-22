import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { CONFIRMED_OR_LATER_STATUSES } from "./reportTypes.js";
import type { ReportFilters } from "./reportTypes.js";

const bookingWhere = (filters: ReportFilters, includeStatus = false): Prisma.BookingWhereInput => ({
  ...(filters.agentId ? { agentId: filters.agentId } : {}),
  ...(includeStatus && filters.status ? { status: filters.status } : {}),
  // serviceType is validated against the distinct values stored in the database before it gets here
  ...(filters.serviceType ? { service: { type: filters.serviceType as never } } : {}),
  ...(filters.from || filters.to
    ? {
        createdAt: {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        },
      }
    : {}),
});

export const listServiceTypes = async (): Promise<string[]> => {
  const rows = await prisma.service.findMany({ distinct: ["type"], select: { type: true } });
  return rows.map((row) => String(row.type));
};

export const getBookingStatusBreakdown = async (filters: ReportFilters) => {
  return prisma.booking.groupBy({
    by: ["status"],
    where: bookingWhere(filters, true),
    _count: { _all: true },
    _sum: { finalPrice: true },
  });
};

export const getFinancialTotals = async (filters: ReportFilters) => {
  const base = bookingWhere(filters);
  const booked = { in: [...CONFIRMED_OR_LATER_STATUSES] };

  const [bookedValue, revenue, collected, outstanding] = await Promise.all([
    prisma.booking.aggregate({ where: { ...base, status: booked }, _sum: { finalPrice: true } }),
    prisma.booking.aggregate({ where: { ...base, status: "COMPLETED" }, _sum: { finalPrice: true } }),
    prisma.payment.aggregate({ where: { status: "VERIFIED", booking: base }, _sum: { amount: true } }),
    prisma.booking.aggregate({
      where: { ...base, status: booked, paymentStatus: "UNPAID" },
      _sum: { finalPrice: true },
    }),
  ]);

  return {
    bookedValue: Number(bookedValue._sum.finalPrice ?? 0),
    revenue: Number(revenue._sum.finalPrice ?? 0),
    collectedPayments: Number(collected._sum.amount ?? 0),
    outstandingBalance: Number(outstanding._sum.finalPrice ?? 0),
  };
};

export const getPaymentBreakdown = async (filters: ReportFilters) => {
  const base = bookingWhere(filters);

  const [byStatus, verifiedByMethod, paidBookings] = await Promise.all([
    prisma.payment.groupBy({
      by: ["status"],
      where: { booking: base },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { booking: base, status: "VERIFIED" },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.booking.aggregate({ where: { ...base, paymentStatus: "PAID" }, _sum: { finalPrice: true } }),
  ]);

  return { byStatus, verifiedByMethod, paidBookingsValue: Number(paidBookings._sum.finalPrice ?? 0) };
};

export const getServiceBreakdown = async (filters: ReportFilters) => {
  const rows = await prisma.booking.groupBy({
    by: ["serviceId", "status"],
    where: bookingWhere(filters, true),
    _count: { _all: true },
    _sum: { finalPrice: true },
  });

  const ids = [...new Set(rows.map((row) => row.serviceId))];
  const services = await prisma.service.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, type: true },
  });

  return { rows, services };
};

export const getAgentBreakdown = async (filters: ReportFilters) => {
  const rows = await prisma.booking.groupBy({
    by: ["agentId", "status"],
    where: { ...bookingWhere(filters, true), agentId: filters.agentId ?? { not: null } },
    _count: { _all: true },
    _sum: { finalPrice: true },
  });

  const ids = [...new Set(rows.map((row) => row.agentId).filter((id): id is string => id !== null))];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });

  return { rows, users };
};

export const getCommissionByStatus = async (filters: ReportFilters) => {
  return prisma.commission.groupBy({
    by: ["status"],
    where: { booking: bookingWhere(filters) },
    _count: { _all: true },
    _sum: { amount: true },
  });
};

export const getCommissionByAgent = async (filters: ReportFilters, includeStatus: boolean) => {
  const rows = await prisma.commission.groupBy({
    by: ["agentId"],
    where: { status: "ACTIVE", booking: bookingWhere(filters, includeStatus) },
    _count: { _all: true },
    _sum: { amount: true },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((row) => row.agentId) } },
    select: { id: true, name: true },
  });

  return { rows, users };
};