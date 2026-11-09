import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";

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
  paymentStatus?: string;
  fulfillmentStatus?: string;
  search?: string;
}

export interface ListAgentCustomersParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface CreateAgentCustomerInput {
  name: string;
  email: string;
  phone?: string | null;
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
  assignedStaffId: true,
  assignedStaff: {
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
  payments: {
    select: {
      id: true,
      amount: true,
      currency: true,
      method: true,
      status: true,
      reference: true,
      stripeSessionId: true,
      receivedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
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

const parseTravelDateFromNotes = (notes?: string | null): string | null => {
  if (!notes || typeof notes !== "string") return null;
  const match = notes.match(/Travel Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return match ? match[1]! : null;
};

const formatAgentBookingItem = (b: any) => {
  const fallbackDate = parseTravelDateFromNotes(b.notes);
  const availability =
    b.availability && b.availability.date
      ? b.availability
      : fallbackDate
        ? { id: `notes-date-${b.id}`, date: new Date(fallbackDate) }
        : null;

  return {
    ...b,
    availability,
    basePrice: Number(b.basePrice),
    proposedPrice: b.proposedPrice !== null ? Number(b.proposedPrice) : null,
    finalPrice: Number(b.finalPrice),
    payments: Array.isArray(b.payments)
      ? b.payments.map((p: any) => ({
          ...p,
          amount: Number(p.amount),
        }))
      : [],
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
  };
};

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
            status: true,
            paymentStatus: true,
          },
        },
      },
    }),
  ]);

  let totalCommission = 0;
  let paidCommission = 0;
  let pendingCommission = 0;
  let activeCount = 0;

  for (const c of commissions) {
    if (c.booking?.status === "CANCELLED" || c.booking?.status === "FAILED") {
      continue;
    }
    activeCount += 1;
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
    activeCommissionsCount: activeCount,
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

  if (params.paymentStatus && params.paymentStatus !== "ALL") {
    where.paymentStatus = params.paymentStatus;
  }

  if (params.fulfillmentStatus && params.fulfillmentStatus !== "ALL") {
    where.fulfillmentStatus = params.fulfillmentStatus;
  }

  if (params.search && params.search.trim()) {
    const query = params.search.trim();
    where.OR = [
      { id: { contains: query, mode: "insensitive" } },
      { customer: { name: { contains: query, mode: "insensitive" } } },
      { customer: { email: { contains: query, mode: "insensitive" } } },
      { service: { name: { contains: query, mode: "insensitive" } } },
      { notes: { contains: query, mode: "insensitive" } },
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

  const formattedItems = items.map(formatAgentBookingItem);

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

  return formatAgentBookingItem(booking);
};

export const listAgentCustomers = async (
  agentId: string,
  params: ListAgentCustomersParams
) => {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
  const skip = (page - 1) * limit;

  const where: any = {
    role: "customer",
    status: "active",
    deletedAt: null,
    customerBookings: {
      some: { agentId },
    },
  };

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.AND = [
      {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        _count: {
          select: {
            customerBookings: {
              where: { agentId },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: items.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      createdAt: u.createdAt,
      bookingsCount: u._count.customerBookings,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const createOrResolveAgentCustomer = async (
  _agentId: string,
  input: CreateAgentCustomerInput
) => {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      deletedAt: true,
      createdAt: true,
    },
  });

  if (existing) {
    if (existing.role !== "customer") {
      throw new AppError(
        "This email belongs to a non-customer account. Please enter the traveler's email address.",
        409
      );
    }
    if (existing.status !== "active" || existing.deletedAt !== null) {
      throw new AppError("This customer account is inactive.", 409);
    }

    // Update phone or name if customer had missing phone
    const shouldUpdate = (phone && !existing.phone) || (name && name !== existing.name);
    if (shouldUpdate) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(name ? { name } : {}),
          ...(phone && !existing.phone ? { phone } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
        },
      });
      return updated;
    }

    return {
      id: existing.id,
      name: existing.name,
      email: existing.email,
      phone: existing.phone,
      createdAt: existing.createdAt,
    };
  }

  const randomPassword = await bcrypt.hash(randomBytes(24).toString("hex"), 10);

  const created = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      password: randomPassword,
      role: "customer",
      status: "active",
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
    },
  });

  return created;
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
