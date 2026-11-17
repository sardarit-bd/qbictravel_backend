import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import type {
  ListStaffDiscountRequestsQuery,
  StaffDiscountRequestResponse,
} from "./discountTypes.js";

export const staffDiscountRequestInclude = {
  booking: {
    select: {
      id: true,
      currency: true,
      status: true,
      paymentStatus: true,
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      service: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  },
  requestedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  reviewedBy: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
} as const;

export const findBookingForDiscount = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      requiresApproval: true,
      currency: true,
      basePrice: true,
      finalPrice: true,
      createdById: true,
      assignedStaffId: true,
      agentId: true,
    },
  });
};

export const findPendingDiscountRequestByBookingId = async (
  bookingId: string,
  tx?: Prisma.TransactionClient
) => {
  const client = tx || prisma;
  return client.staffDiscountRequest.findFirst({
    where: {
      bookingId,
      status: "PENDING",
    },
  });
};

export const findDiscountRequestById = async (
  requestId: string,
  tx?: Prisma.TransactionClient
) => {
  const client = tx || prisma;
  return client.staffDiscountRequest.findUnique({
    where: { id: requestId },
    include: staffDiscountRequestInclude,
  });
};

export const listDiscountRequests = async (params: ListStaffDiscountRequestsQuery) => {
  const {
    page = 1,
    limit = 20,
    status,
    bookingId,
    requestedById,
    reviewedById,
    startDate,
    endDate,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = params;

  const skip = (page - 1) * limit;

  const where: Prisma.StaffDiscountRequestWhereInput = {
    ...(status ? { status } : {}),
    ...(bookingId ? { bookingId } : {}),
    ...(requestedById ? { requestedById } : {}),
    ...(reviewedById ? { reviewedById } : {}),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {}),
          },
        }
      : {}),
    ...(search && search.trim()
      ? {
          OR: [
            { bookingId: { contains: search.trim(), mode: "insensitive" } },
            { reason: { contains: search.trim(), mode: "insensitive" } },
            {
              booking: {
                customer: {
                  OR: [
                    { name: { contains: search.trim(), mode: "insensitive" } },
                    { email: { contains: search.trim(), mode: "insensitive" } },
                  ],
                },
              },
            },
            {
              requestedBy: {
                OR: [
                  { name: { contains: search.trim(), mode: "insensitive" } },
                  { email: { contains: search.trim(), mode: "insensitive" } },
                ],
              },
            },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.staffDiscountRequest.findMany({
      where,
      include: staffDiscountRequestInclude,
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit,
    }),
    prisma.staffDiscountRequest.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
};

export const getDiscountSummary = async () => {
  const [
    totalRequests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    approvedAmountAgg,
    staffGrouped,
  ] = await Promise.all([
    prisma.staffDiscountRequest.count(),
    prisma.staffDiscountRequest.count({ where: { status: "PENDING" } }),
    prisma.staffDiscountRequest.count({ where: { status: "APPROVED" } }),
    prisma.staffDiscountRequest.count({ where: { status: "REJECTED" } }),
    prisma.staffDiscountRequest.aggregate({
      where: { status: "APPROVED" },
      _sum: { approvedDiscountAmount: true },
    }),
    prisma.staffDiscountRequest.groupBy({
      by: ["requestedById"],
      _count: { _all: true },
    }),
  ]);

  const staffIds = staffGrouped.map((g) => g.requestedById);
  const users = await prisma.user.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, name: true, email: true },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  const staffStats = await Promise.all(
    staffGrouped.map(async (group) => {
      const staffId = group.requestedById;
      const user = userMap.get(staffId);

      const [pending, approved, rejected, sumApproved] = await Promise.all([
        prisma.staffDiscountRequest.count({
          where: { requestedById: staffId, status: "PENDING" },
        }),
        prisma.staffDiscountRequest.count({
          where: { requestedById: staffId, status: "APPROVED" },
        }),
        prisma.staffDiscountRequest.count({
          where: { requestedById: staffId, status: "REJECTED" },
        }),
        prisma.staffDiscountRequest.aggregate({
          where: { requestedById: staffId, status: "APPROVED" },
          _sum: { approvedDiscountAmount: true },
        }),
      ]);

      return {
        staffId,
        staffName: user?.name || "Unknown Staff",
        staffEmail: user?.email || "",
        totalRequests: group._count._all,
        pendingRequests: pending,
        approvedRequests: approved,
        rejectedRequests: rejected,
        totalApprovedDiscountAmount: Number(sumApproved._sum.approvedDiscountAmount || 0),
      };
    })
  );

  return {
    totalRequests,
    pendingRequests,
    approvedRequests,
    rejectedRequests,
    totalApprovedDiscountAmount: Number(approvedAmountAgg._sum.approvedDiscountAmount || 0),
    staffStats,
  };
};
