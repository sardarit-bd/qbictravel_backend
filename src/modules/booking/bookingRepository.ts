import { prisma } from "../../lib/prisma.js";
import type { CreateBookingInput } from "./bookingTypes.js";

export const createBooking = async (input: CreateBookingInput & { 
  currency: string;
  basePrice: number; 
  finalPrice: number; 
  status: string; 
  requiresApproval: boolean 
}) => {
  return prisma.booking.create({
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

    return tx.booking.update({
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
  });
};

export const rejectPriceApproval = async (bookingId: string, adminId: string, notes?: string) => {
  return prisma.$transaction(async (tx) => {
    await tx.priceApproval.update({
      where: { bookingId },
      data: {
        status: "REJECTED",
        adminId,
        reviewedAt: new Date(),
        notes: notes || null,
      },
    });

    return tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
        requiresApproval: false,
      },
      include: {
        priceApproval: true,
      },
    });
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
