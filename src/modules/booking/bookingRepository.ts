import { prisma } from "../../lib/prisma.js";
import type { CreateBookingInput } from "./bookingTypes.js";

export const createBooking = async (input: CreateBookingInput & { 
  currency: string;
  basePrice: number; 
  finalPrice: number; 
  status: string; 
  requiresApproval: boolean 
}) => {
  return prisma.$transaction(async (tx) => {
    const created = await tx.booking.create({
      data: {
        customerId: input.customerId,
        agentId: input.agentId || null,
        serviceId: input.serviceId,
        availabilityId: input.availabilityId || null,
        currency: input.currency,
        basePrice: input.basePrice, // Pass number directly
        proposedPrice: input.proposedPrice !== undefined ? Number(input.proposedPrice) : null,
        finalPrice: input.finalPrice,
        status: input.status as any,
        requiresApproval: input.requiresApproval,
        notes: input.notes || null,
      },
      include: {
        priceApproval: true,
      },
    });

    await tx.bookingHistory.create({
      data: {
        bookingId: created.id,
        actorId: input.agentId || input.customerId,
        actorRole: input.agentId ? "agent" : "customer",
        action: "BOOKING_CREATED",
        changes: {
          status: input.status,
          basePrice: input.basePrice,
          finalPrice: input.finalPrice,
          currency: input.currency,
          requiresApproval: input.requiresApproval,
          notes: input.notes || null,
        },
      },
    });

    return created;
  });
};

export const findBookingById = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      priceApproval: true,
    },
  });
};

export const updateBookingPriceApproval = async (bookingId: string, input: { approvedPrice: number; adminId: string; notes?: string }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { status: true, finalPrice: true, proposedPrice: true, currency: true },
    });

    await tx.priceApproval.update({
      where: { bookingId },
      data: {
        approvedPrice: input.approvedPrice, // Pass number directly
        status: "APPROVED",
        adminId: input.adminId,
        reviewedAt: new Date(),
        notes: input.notes || null,
      },
    });

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        finalPrice: input.approvedPrice,
        status: "CONFIRMED",
        requiresApproval: false,
      },
      include: {
        priceApproval: true,
      },
    });

    await tx.bookingHistory.create({
      data: {
        bookingId,
        actorId: input.adminId,
        actorRole: "admin",
        action: "PRICE_APPROVED",
        changes: {
          previousStatus: existing?.status ?? "AWAITING_APPROVAL",
          newStatus: "CONFIRMED",
          previousPrice: existing ? Number(existing.finalPrice) : null,
          approvedPrice: input.approvedPrice,
          currency: existing?.currency ?? null,
          notes: input.notes || null,
        },
      },
    });

    return updated;
  });
};

export const rejectPriceApproval = async (bookingId: string, adminId: string, notes?: string) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { status: true, finalPrice: true, proposedPrice: true, currency: true },
    });

    await tx.priceApproval.update({
      where: { bookingId },
      data: {
        status: "REJECTED",
        adminId,
        reviewedAt: new Date(),
        notes: notes || null,
      },
    });

    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
        requiresApproval: false,
      },
      include: {
        priceApproval: true,
      },
    });

    if (tx.commission) {
      await tx.commission.updateMany({
        where: { bookingId, status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });
    }

    await tx.bookingHistory.create({
      data: {
        bookingId,
        actorId: adminId,
        actorRole: "admin",
        action: "PRICE_REJECTED",
        changes: {
          previousStatus: existing?.status ?? "AWAITING_APPROVAL",
          newStatus: "CANCELLED",
          proposedPrice: existing?.proposedPrice != null ? Number(existing.proposedPrice) : null,
          currency: existing?.currency ?? null,
          notes: notes || null,
        },
      },
    });

    return updated;
  });
};

export const createPriceApproval = async (bookingId: string, requestedPrice: number) => {
  return prisma.priceApproval.create({
    data: {
      bookingId,
      requestedPrice: requestedPrice,
      status: "PENDING",
    },
  });
};
export const findActiveCustomer = async (customerId: string) => {
  return prisma.user.findFirst({
    where: { id: customerId, role: "customer", status: "active" },
    select: { id: true },
  });
};

const adminReservationSelect = {
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
  internalNotes: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
    },
  },
  agent: {
    select: {
      id: true,
      name: true,
      email: true,
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
  assignedStaffId: true,
  assignedStaff: {
    select: {
      id: true,
      name: true,
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
      requestedPrice: true,
      approvedPrice: true,
      status: true,
      notes: true,
      reviewedAt: true,
    },
  },
} as const;

export const listPendingReservations = async (params: {
  skip: number;
  take: number;
  search?: string;
  paymentStatus?: string;
}) => {
  const where: any = {
    status: { in: ["PENDING", "AWAITING_APPROVAL"] },
  };

  if (params.paymentStatus) {
    where.paymentStatus = params.paymentStatus;
  }

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { email: { contains: q, mode: "insensitive" } } },
      { service: { name: { contains: q, mode: "insensitive" } } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: adminReservationSelect,
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, total };
};

export const findPendingReservationById = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: adminReservationSelect,
  });
};

export const confirmPendingBooking = async (params: {
  bookingId: string;
  adminId: string;
  notes?: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
      include: { priceApproval: true },
    });

    if (!booking) {
      return null;
    }

    if (booking.status !== "PENDING") {
      throw new Error(`Cannot confirm booking in ${booking.status} status`);
    }

    if (booking.requiresApproval) {
      throw new Error("Booking requires price approval before confirmation");
    }

    const updated = await tx.booking.update({
      where: { id: params.bookingId },
      data: {
        status: "CONFIRMED",
        ...(params.notes ? { internalNotes: params.notes } : {}),
      },
      select: adminReservationSelect,
    });

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.adminId,
        actorRole: "admin",
        action: "BOOKING_CONFIRMED",
        changes: {
          previousStatus: "PENDING",
          newStatus: "CONFIRMED",
          notes: params.notes ?? null,
        },
      },
    });

    return updated;
  });
};

export const rejectPendingBooking = async (params: {
  bookingId: string;
  adminId: string;
  notes?: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
    });

    if (!booking) {
      return null;
    }

    if (booking.status !== "PENDING" && booking.status !== "AWAITING_APPROVAL") {
      throw new Error(`Cannot reject booking in ${booking.status} status`);
    }

    const updated = await tx.booking.update({
      where: { id: params.bookingId },
      data: {
        status: "CANCELLED",
        ...(params.notes ? { internalNotes: params.notes } : {}),
      },
      select: adminReservationSelect,
    });

    if (tx.commission) {
      await tx.commission.updateMany({
        where: { bookingId: params.bookingId, status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });
    }

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.adminId,
        actorRole: "admin",
        action: "BOOKING_REJECTED",
        changes: {
          previousStatus: booking.status,
          newStatus: "CANCELLED",
          notes: params.notes ?? null,
        },
      },
    });

    return updated;
  });
};

export const findBookingHistory = async (params: {
  bookingId: string;
  skip: number;
  take: number;
  assignedStaffId?: string;
  agentId?: string;
}) => {
  const booking = await prisma.booking.findFirst({
    where: {
      id: params.bookingId,
      ...(params.assignedStaffId ? { assignedStaffId: params.assignedStaffId } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
    },
    select: { id: true },
  });

  if (!booking) {
    return null;
  }

  const [rawItems, total] = await Promise.all([
    prisma.bookingHistory.findMany({
      where: { bookingId: params.bookingId },
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
    }),
    prisma.bookingHistory.count({
      where: { bookingId: params.bookingId },
    }),
  ]);

  // Collect all referenced user IDs (actors and staff in changes) to resolve human-readable names safely
  const userIdsSet = new Set<string>();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const item of rawItems) {
    if (item.actorId && uuidRegex.test(item.actorId)) {
      userIdsSet.add(item.actorId);
    }
    const changes = item.changes as Record<string, any> | null;
    if (changes && typeof changes === "object") {
      if (typeof changes.previousStaffId === "string" && uuidRegex.test(changes.previousStaffId)) {
        userIdsSet.add(changes.previousStaffId);
      }
      if (typeof changes.newStaffId === "string" && uuidRegex.test(changes.newStaffId)) {
        userIdsSet.add(changes.newStaffId);
      }
    }
  }

  const userIds = Array.from(userIdsSet);
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, role: true },
        })
      : [];

  const userMap = new Map<string, { id: string; name: string | null; role: string }>();
  for (const u of users) {
    userMap.set(u.id, u);
  }

  const items = rawItems.map((item) => {
    const actorUser = userMap.get(item.actorId);
    const changes =
      item.changes && typeof item.changes === "object"
        ? { ...(item.changes as Record<string, any>) }
        : {};

    // Enrich staff names if not already stored in changes
    if (changes.previousStaffId && !changes.previousStaffName) {
      const prevStaff = userMap.get(changes.previousStaffId);
      if (prevStaff?.name) {
        changes.previousStaffName = prevStaff.name;
      }
    }
    if (changes.newStaffId && !changes.newStaffName) {
      const nextStaff = userMap.get(changes.newStaffId);
      if (nextStaff?.name) {
        changes.newStaffName = nextStaff.name;
      }
    }

    const isSystemAction =
      item.action.startsWith("STRIPE_") || item.action === "BOOKING_AUTO_CONFIRMED";

    return {
      id: item.id,
      bookingId: item.bookingId,
      actorId: item.actorId,
      actorName: actorUser?.name || (isSystemAction ? "System (Stripe)" : null),
      actorRole: item.actorRole,
      action: item.action,
      changes,
      createdAt: item.createdAt,
    };
  });

  return { items, total };
};
