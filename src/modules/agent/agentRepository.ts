import { prisma } from "../../lib/prisma.js";

export type AgentBookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "AWAITING_APPROVAL"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export interface AgentOverviewMetrics {
  totalBookings: number;
  pendingBookings: number;
  confirmedBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  totalCommission: number;
  paidCommission: number;
  pendingCommission: number;
  activeCommissionsCount: number;
}

export interface ListAgentBookingsParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export interface UpdateAgentProfileInput {
  agencyName?: string;
  name?: string;
  phone?: string | null;
}

const agentBookingSelect = {
  id: true,
  status: true,
  paymentStatus: true,
  fulfillmentStatus: true,
  currency: true,
  basePrice: true,
  proposedPrice: true,
  finalPrice: true,
  requiresApproval: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  service: {
    select: {
      id: true,
      name: true,
      type: true,
    },
  },
  availability: {
    select: {
      id: true,
      date: true,
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
  priceApproval: {
    select: {
      id: true,
      status: true,
      requestedPrice: true,
      approvedPrice: true,
      notes: true,
      reviewedAt: true,
    },
  },
  commission: {
    select: {
      id: true,
      amount: true,
      status: true,
    },
  },
} as const;

export const getAgentOverview = async (agentId: string): Promise<AgentOverviewMetrics> => {
  const [
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
    commissions,
  ] = await Promise.all([
    prisma.booking.count({
      where: { agentId },
    }),
    prisma.booking.count({
      where: {
        agentId,
        status: { in: ["PENDING", "AWAITING_APPROVAL"] },
      },
    }),
    prisma.booking.count({
      where: {
        agentId,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
      },
    }),
    prisma.booking.count({
      where: {
        agentId,
        status: "COMPLETED",
      },
    }),
    prisma.booking.count({
      where: {
        agentId,
        status: { in: ["CANCELLED", "FAILED"] },
      },
    }),
    prisma.commission.findMany({
      where: {
        agentId,
        status: "ACTIVE",
      },
      select: {
        amount: true,
        booking: {
          select: {
            paymentStatus: true,
          },
        },
      },
    }),
  ]);

  let totalCommission = 0;
  let paidCommission = 0;
  let pendingCommission = 0;

  for (const c of commissions) {
    const val = Number(c.amount);
    totalCommission += val;
    if (c.booking?.paymentStatus === "PAID") {
      paidCommission += val;
    } else {
      pendingCommission += val;
    }
  }

  return {
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
    cancelledBookings,
    totalCommission: Math.round(totalCommission * 100) / 100,
    paidCommission: Math.round(paidCommission * 100) / 100,
    pendingCommission: Math.round(pendingCommission * 100) / 100,
    activeCommissionsCount: commissions.length,
  };
};

export const listAgentBookings = async (
  agentId: string,
  params: ListAgentBookingsParams
) => {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 10));
  const skip = (page - 1) * limit;

  const where: any = {
    agentId,
  };

  if (params.status && params.status !== "ALL") {
    where.status = params.status;
  }

  if (params.search && params.search.trim()) {
    const query = params.search.trim();
    where.OR = [
      { id: { contains: query, mode: "insensitive" } },
      { customer: { name: { contains: query, mode: "insensitive" } } },
      { customer: { email: { contains: query, mode: "insensitive" } } },
      { service: { name: { contains: query, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: agentBookingSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  const formattedItems = items.map((b) => ({
    ...b,
    basePrice: Number(b.basePrice),
    proposedPrice: b.proposedPrice !== null ? Number(b.proposedPrice) : null,
    finalPrice: Number(b.finalPrice),
    priceApproval: b.priceApproval
      ? {
          ...b.priceApproval,
          requestedPrice: Number(b.priceApproval.requestedPrice),
          approvedPrice:
            b.priceApproval.approvedPrice !== null
              ? Number(b.priceApproval.approvedPrice)
              : null,
        }
      : null,
    commission: b.commission
      ? {
          ...b.commission,
          amount: Number(b.commission.amount),
        }
      : null,
  }));

  return {
    items: formattedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const findAgentBookingById = async (agentId: string, bookingId: string) => {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      agentId,
    },
    select: agentBookingSelect,
  });

  if (!booking) return null;

  return {
    ...booking,
    basePrice: Number(booking.basePrice),
    proposedPrice: booking.proposedPrice !== null ? Number(booking.proposedPrice) : null,
    finalPrice: Number(booking.finalPrice),
    priceApproval: booking.priceApproval
      ? {
          ...booking.priceApproval,
          requestedPrice: Number(booking.priceApproval.requestedPrice),
          approvedPrice:
            booking.priceApproval.approvedPrice !== null
              ? Number(booking.priceApproval.approvedPrice)
              : null,
        }
      : null,
    commission: booking.commission
      ? {
          ...booking.commission,
          amount: Number(booking.commission.amount),
        }
      : null,
  };
};

export const findAgentProfile = async (agentId: string) => {
  const user = await prisma.user.findFirst({
    where: {
      id: agentId,
      role: "agent",
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      agentProfile: {
        select: {
          agencyName: true,
        },
      },
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    agencyName: user.agentProfile?.agencyName || null,
    createdAt: user.createdAt,
  };
};

export const updateAgentProfile = async (
  agentId: string,
  data: UpdateAgentProfileInput
) => {
  const { agencyName, name, phone } = data;

  const updated = await prisma.user.update({
    where: { id: agentId },
    data: {
      ...(name ? { name } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(agencyName !== undefined
        ? {
            agentProfile: {
              upsert: {
                create: { agencyName },
                update: { agencyName },
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      agentProfile: {
        select: {
          agencyName: true,
        },
      },
    },
  });

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    phone: updated.phone,
    role: updated.role,
    status: updated.status,
    agencyName: updated.agentProfile?.agencyName || null,
    createdAt: updated.createdAt,
  };
};
