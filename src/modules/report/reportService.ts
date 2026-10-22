import AppError from "../../shared/utils/AppError.js";
import { parseEnumQuery, parsePagination, parseUuidQuery } from "../../shared/utils/pagination.js";
import * as reportRepository from "./reportRepository.js";
import { BOOKING_STATUSES, CONFIRMED_OR_LATER_STATUSES } from "./reportTypes.js";
import type { ReportFilters } from "./reportTypes.js";

type Query = Record<string, unknown>;

const money = (value: unknown): number => Math.round(Number(value ?? 0) * 100) / 100;

const isBooked = (status: string): boolean => (CONFIRMED_OR_LATER_STATUSES as readonly string[]).includes(status);

const parseDate = (value: unknown, name: string, endOfDay: boolean): Date | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AppError(`Invalid ${name}`, 400);

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly && endOfDay ? `${value}T23:59:59.999Z` : value);

  if (Number.isNaN(date.getTime())) throw new AppError(`Invalid ${name}`, 400);
  return date;
};

const parseFilters = async (query: Query, forcedAgentId?: string): Promise<ReportFilters> => {
  const from = parseDate(query.from, "from", false);
  const to = parseDate(query.to, "to", true);

  if (from && to && from.getTime() > to.getTime()) {
    throw new AppError("The from date must not be after the to date", 400);
  }

  let serviceType: string | undefined;
  if (query.serviceType !== undefined) {
    if (typeof query.serviceType !== "string") throw new AppError("Invalid serviceType", 400);
    const knownTypes = await reportRepository.listServiceTypes();
    if (!knownTypes.includes(query.serviceType)) throw new AppError("Invalid serviceType", 400);
    serviceType = query.serviceType;
  }

  return {
    from,
    to,
    status: parseEnumQuery(query.status, BOOKING_STATUSES, "status"),
    serviceType,
    agentId: forcedAgentId ?? parseUuidQuery(query.agentId, "agentId"),
  };
};

const describeFilters = (filters: ReportFilters, includeStatus: boolean) => ({
  from: filters.from?.toISOString() ?? null,
  to: filters.to?.toISOString() ?? null,
  serviceType: filters.serviceType ?? null,
  agentId: filters.agentId ?? null,
  ...(includeStatus ? { status: filters.status ?? null } : {}),
});

const paginate = <T>(items: T[], query: Query) => {
  const { page, limit, skip } = parsePagination(query);
  return { items: items.slice(skip, skip + limit), page, limit, total: items.length };
};

const bookingsReport = async (filters: ReportFilters) => {
  const rows = await reportRepository.getBookingStatusBreakdown(filters);
  const byStatus = rows.map((row) => ({
    status: row.status,
    count: row._count._all,
    totalValue: money(row._sum.finalPrice),
  }));

  return {
    filters: describeFilters(filters, true),
    totalBookings: byStatus.reduce((sum, row) => sum + row.count, 0),
    byStatus,
  };
};

const revenueReport = async (filters: ReportFilters) => {
  const totals = await reportRepository.getFinancialTotals(filters);
  return {
    filters: describeFilters(filters, false),
    bookedValue: money(totals.bookedValue),
    revenue: money(totals.revenue),
    collectedPayments: money(totals.collectedPayments),
    outstandingBalance: money(totals.outstandingBalance),
  };
};

const commissionTotals = (rows: { status: string; _count: { _all: number }; _sum: { amount: unknown } }[]) => {
  const byStatus = rows.map((row) => ({
    status: row.status,
    count: row._count._all,
    totalAmount: money(row._sum.amount),
  }));
  const active = byStatus.find((row) => row.status === "ACTIVE");

  return {
    count: byStatus.reduce((sum, row) => sum + row.count, 0),
    totalActiveAmount: active?.totalAmount ?? 0,
    byStatus,
  };
};

export const getAdminBookingsReport = async (query: Query) => bookingsReport(await parseFilters(query));

export const getAdminRevenueReport = async (query: Query) => revenueReport(await parseFilters(query));

export const getAdminPaymentsReport = async (query: Query) => {
  const filters = await parseFilters(query);
  const breakdown = await reportRepository.getPaymentBreakdown(filters);

  const byStatus = breakdown.byStatus.map((row) => ({
    status: row.status,
    count: row._count._all,
    totalAmount: money(row._sum.amount),
  }));
  const verified = byStatus.find((row) => row.status === "VERIFIED");
  const submitted = byStatus.find((row) => row.status === "SUBMITTED");

  return {
    filters: describeFilters(filters, false),
    byStatus,
    verifiedByMethod: breakdown.verifiedByMethod.map((row) => ({
      method: row.method,
      count: row._count._all,
      totalAmount: money(row._sum.amount),
    })),
    reconciliation: {
      paidBookingsValue: money(breakdown.paidBookingsValue),
      verifiedPaymentsValue: verified?.totalAmount ?? 0,
      difference: money(breakdown.paidBookingsValue - (verified?.totalAmount ?? 0)),
      pendingVerificationCount: submitted?.count ?? 0,
      pendingVerificationValue: submitted?.totalAmount ?? 0,
    },
  };
};

export const getAdminServicesReport = async (query: Query) => {
  parsePagination(query);
  const filters = await parseFilters(query);
  const { rows, services } = await reportRepository.getServiceBreakdown(filters);
  const serviceById = new Map(services.map((service) => [service.id, service]));

  const entries = new Map<
    string,
    { serviceId: string; totalBookings: number; completedBookings: number; bookedValue: number; revenue: number }
  >();

  for (const row of rows) {
    const entry = entries.get(row.serviceId) ?? {
      serviceId: row.serviceId,
      totalBookings: 0,
      completedBookings: 0,
      bookedValue: 0,
      revenue: 0,
    };
    const value = Number(row._sum.finalPrice ?? 0);

    entry.totalBookings += row._count._all;
    if (isBooked(row.status)) entry.bookedValue += value;
    if (row.status === "COMPLETED") {
      entry.completedBookings += row._count._all;
      entry.revenue += value;
    }
    entries.set(row.serviceId, entry);
  }

  const items = [...entries.values()]
    .map((entry) => ({
      ...entry,
      name: serviceById.get(entry.serviceId)?.name ?? null,
      type: serviceById.get(entry.serviceId)?.type ?? null,
      bookedValue: money(entry.bookedValue),
      revenue: money(entry.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || b.totalBookings - a.totalBookings);

  return { filters: describeFilters(filters, true), ...paginate(items, query) };
};

export const getAdminAgentsReport = async (query: Query) => {
  parsePagination(query);
  const filters = await parseFilters(query);
  const [{ rows, users }, commissions] = await Promise.all([
    reportRepository.getAgentBreakdown(filters),
    reportRepository.getCommissionByAgent(filters, true),
  ]);

  const nameById = new Map(users.map((user) => [user.id, user.name]));
  const commissionByAgent = new Map(commissions.rows.map((row) => [row.agentId, money(row._sum.amount)]));

  const entries = new Map<
    string,
    { agentId: string; totalBookings: number; completedBookings: number; bookedValue: number; revenue: number }
  >();

  for (const row of rows) {
    if (row.agentId === null) continue;
    const entry = entries.get(row.agentId) ?? {
      agentId: row.agentId,
      totalBookings: 0,
      completedBookings: 0,
      bookedValue: 0,
      revenue: 0,
    };
    const value = Number(row._sum.finalPrice ?? 0);

    entry.totalBookings += row._count._all;
    if (isBooked(row.status)) entry.bookedValue += value;
    if (row.status === "COMPLETED") {
      entry.completedBookings += row._count._all;
      entry.revenue += value;
    }
    entries.set(row.agentId, entry);
  }

  const items = [...entries.values()]
    .map((entry) => ({
      ...entry,
      name: nameById.get(entry.agentId) ?? null,
      bookedValue: money(entry.bookedValue),
      revenue: money(entry.revenue),
      commissionTotal: commissionByAgent.get(entry.agentId) ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.totalBookings - a.totalBookings);

  return { filters: describeFilters(filters, true), ...paginate(items, query) };
};

export const getAdminCommissionsReport = async (query: Query) => {
  parsePagination(query);
  const filters = await parseFilters(query);
  const [byStatusRows, byAgent] = await Promise.all([
    reportRepository.getCommissionByStatus(filters),
    reportRepository.getCommissionByAgent(filters, false),
  ]);

  const nameById = new Map(byAgent.users.map((user) => [user.id, user.name]));
  const items = byAgent.rows
    .map((row) => ({
      agentId: row.agentId,
      name: nameById.get(row.agentId) ?? null,
      count: row._count._all,
      totalAmount: money(row._sum.amount),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    filters: describeFilters(filters, false),
    ...commissionTotals(byStatusRows as any),
    ...paginate(items, query),
  };
};

export const getAgentBookingsReport = async (agentId: string, query: Query) =>
  bookingsReport(await parseFilters(query, agentId));

export const getAgentRevenueReport = async (agentId: string, query: Query) =>
  revenueReport(await parseFilters(query, agentId));

export const getAgentCommissionsReport = async (agentId: string, query: Query) => {
  const filters = await parseFilters(query, agentId);
  const byStatusRows = await reportRepository.getCommissionByStatus(filters);
  return { filters: describeFilters(filters, false), ...commissionTotals(byStatusRows as any) };
};