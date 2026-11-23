import { prisma } from "../../lib/prisma.js";
import type { CreateBookingInput } from "./bookingTypes.js";

export const createBooking = async (
  input: CreateBookingInput & { 
    currency: string;
    basePrice: number; 
    finalPrice: number; 
    status: string; 
    requiresApproval: boolean;
    createdById?: string | null;
    assignedStaffId?: string | null;
    source?: "AGENT" | "ADMIN" | "CUSTOMER" | "DIRECT";
    historyAction?: string;
    actorRole?: string;
    isGuest?: boolean;
  },
  txClient?: any
) => {
  const execute = async (tx: any) => {
    const created = await tx.booking.create({
      data: {
        customerId: input.customerId,
        agentId: input.agentId || null,
        createdById: input.createdById ?? (input.agentId || input.customerId),
        assignedStaffId: input.assignedStaffId ?? null,
        source: input.source || (input.agentId ? "AGENT" : "CUSTOMER"),
        serviceId: input.serviceId,
        availabilityId: input.availabilityId || null,
        currency: input.currency,
        basePrice: input.basePrice, // Pass number directly
        proposedPrice: input.proposedPrice !== undefined ? Number(input.proposedPrice) : null,
        finalPrice: input.finalPrice,
        status: input.status as any,
        requiresApproval: input.requiresApproval,
        notes: input.notes || null,
        isGuest: input.isGuest ?? false,
      },
      include: {
        priceApproval: true,
      },
    });

    await tx.bookingHistory.create({
      data: {
        bookingId: created.id,
        actorId: input.createdById || input.agentId || input.customerId,
        actorRole: input.actorRole || input.source?.toLowerCase() || (input.agentId ? "agent" : "customer"),
        action: input.historyAction || "BOOKING_CREATED",
        changes: {
          status: input.status,
          source: created.source,
          createdById: created.createdById,
          basePrice: input.basePrice,
          finalPrice: input.finalPrice,
          currency: input.currency,
          requiresApproval: input.requiresApproval,
          notes: input.notes || null,
        },
      },
    });

    return created;
  };

  if (txClient) {
    return execute(txClient);
  }
  return prisma.$transaction(execute);
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
  source: true,
  createdById: true,
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
  agentId: true,
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

export const listStaffCreatedBookings = async (
  staffId: string,
  params: {
    skip: number;
    take: number;
    status?: string;
    paymentStatus?: string;
    fulfillmentStatus?: string;
    search?: string;
  }
) => {
  const where: any = {
    createdById: staffId,
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

export const confirmPendingBooking = async (params: {
  bookingId: string;
  adminId: string;
  notes?: string;
  approvedDiscountValue?: number;
}) => {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
      include: {
        priceApproval: true,
        discountRequests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!booking) {
      return null;
    }

    if (booking.status !== "PENDING" && booking.status !== "AWAITING_APPROVAL") {
      throw new Error(`Cannot confirm booking in ${booking.status} status`);
    }

    // If agent price approval is pending, it must be approved via price negotiation endpoint
    if (booking.priceApproval && booking.priceApproval.status === "PENDING") {
      throw new Error("Booking requires price approval before confirmation");
    }

    let finalPrice = Number(booking.finalPrice);
    const pendingDiscount = booking.discountRequests?.[0];

    if (pendingDiscount) {
      const originalPrice = Number(booking.basePrice);
      const requestedValue = Number(pendingDiscount.discountValue);
      let approvedDiscountAmount = 0;
      let approvedFinalPrice = originalPrice;

      if (params.approvedDiscountValue !== undefined && params.approvedDiscountValue !== null) {
        const customVal = Number(params.approvedDiscountValue);
        if (customVal <= 0) {
          throw new Error("Approved discount value must be greater than zero");
        }
        if (customVal > requestedValue) {
          throw new Error("Approved discount cannot exceed the requested discount");
        }

        if (pendingDiscount.discountType === "PERCENTAGE") {
          approvedDiscountAmount = Math.round(originalPrice * (customVal / 100) * 100) / 100;
        } else {
          approvedDiscountAmount = Math.round(customVal * 100) / 100;
        }
      } else {
        // Full approval of requested discount
        approvedDiscountAmount = Number(pendingDiscount.discountAmount);
      }

      approvedFinalPrice = Math.round((originalPrice - approvedDiscountAmount) * 100) / 100;
      if (approvedFinalPrice <= 0) {
        throw new Error("Approved final price must be greater than zero");
      }

      finalPrice = approvedFinalPrice;

      // Update StaffDiscountRequest
      await tx.staffDiscountRequest.update({
        where: { id: pendingDiscount.id },
        data: {
          status: "APPROVED",
          approvedDiscountAmount,
          approvedFinalPrice,
          adminNotes: params.notes ? params.notes.trim() : null,
          reviewedById: params.adminId,
          reviewedAt: new Date(),
        },
      });

      // Append StaffDiscountAuditEvent
      const adminUser = await tx.user.findUnique({
        where: { id: params.adminId },
        select: { id: true, role: true },
      });

      await tx.staffDiscountAuditEvent.create({
        data: {
          discountRequestId: pendingDiscount.id,
          bookingId: booking.id,
          actorId: params.adminId,
          actorRole: adminUser?.role || "admin",
          action: "DISCOUNT_APPROVED",
          previousStatus: "PENDING",
          newStatus: "APPROVED",
          originalPrice,
          discountType: pendingDiscount.discountType,
          discountValue: Number(pendingDiscount.discountValue),
          requestedDiscountAmount: Number(pendingDiscount.discountAmount),
          proposedFinalPrice: Number(pendingDiscount.proposedFinalPrice),
          approvedDiscountAmount,
          finalPrice: approvedFinalPrice,
          reason: pendingDiscount.reason,
          adminNotes: params.notes ? params.notes.trim() : null,
          metadata: {
            currency: booking.currency,
            approvalSource: "UNIFIED_ADMIN_BOOKING_APPROVAL",
          },
        },
      });
    }

    const updated = await tx.booking.update({
      where: { id: params.bookingId },
      data: {
        status: "CONFIRMED",
        finalPrice,
        requiresApproval: false,
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
          previousStatus: booking.status,
          newStatus: "CONFIRMED",
          finalPrice,
          notes: params.notes ?? null,
          discountApproved: Boolean(pendingDiscount),
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
  rejectionReason?: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
      include: {
        discountRequests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!booking) {
      return null;
    }

    if (booking.status !== "PENDING" && booking.status !== "AWAITING_APPROVAL") {
      throw new Error(`Cannot reject booking in ${booking.status} status`);
    }

    const rejectionReasonText = params.rejectionReason?.trim() || params.notes?.trim() || "Rejected by administrator";

    const pendingDiscount = booking.discountRequests?.[0];
    if (pendingDiscount) {
      await tx.staffDiscountRequest.update({
        where: { id: pendingDiscount.id },
        data: {
          status: "REJECTED",
          rejectionReason: rejectionReasonText,
          adminNotes: params.notes?.trim() || null,
          reviewedById: params.adminId,
          reviewedAt: new Date(),
        },
      });

      const adminUser = await tx.user.findUnique({
        where: { id: params.adminId },
        select: { id: true, role: true },
      });

      await tx.staffDiscountAuditEvent.create({
        data: {
          discountRequestId: pendingDiscount.id,
          bookingId: booking.id,
          actorId: params.adminId,
          actorRole: adminUser?.role || "admin",
          action: "DISCOUNT_REJECTED",
          previousStatus: "PENDING",
          newStatus: "REJECTED",
          originalPrice: Number(booking.basePrice),
          discountType: pendingDiscount.discountType,
          discountValue: Number(pendingDiscount.discountValue),
          requestedDiscountAmount: Number(pendingDiscount.discountAmount),
          proposedFinalPrice: Number(pendingDiscount.proposedFinalPrice),
          approvedDiscountAmount: null,
          finalPrice: Number(booking.basePrice),
          reason: pendingDiscount.reason,
          rejectionReason: rejectionReasonText,
          adminNotes: params.notes?.trim() || null,
          metadata: {
            currency: booking.currency,
            rejectionSource: "UNIFIED_ADMIN_BOOKING_APPROVAL",
          },
        },
      });
    }

    const updated = await tx.booking.update({
      where: { id: params.bookingId },
      data: {
        status: "CANCELLED",
        requiresApproval: false,
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
          rejectionReason: rejectionReasonText,
          discountRejected: Boolean(pendingDiscount),
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
      ...(params.assignedStaffId
        ? {
            OR: [
              { assignedStaffId: params.assignedStaffId },
              { createdById: params.assignedStaffId },
            ],
          }
        : {}),
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

export interface ListStaffCustomersParams {
  page?: number;
  limit?: number;
  search?: string;
}

export const listStaffCustomers = async (params: ListStaffCustomersParams) => {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
  const skip = (page - 1) * limit;

  const where: any = {
    role: "customer",
    status: "active",
    deletedAt: null,
  };

  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
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
      },
      orderBy: { name: "asc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Finds a GuestBookingToken record by its SHA-256 token hash.
 * Includes associated Booking, Service, GuestBookingSnapshot, and PaymentLink.
 */
export const findGuestBookingTokenByHash = async (tokenHash: string) => {
  return prisma.guestBookingToken.findUnique({
    where: { tokenHash },
    include: {
      booking: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              type: true,
              description: true,
              providerName: true,
              metadata: true,
            },
          },
          availability: {
            select: {
              date: true,
            },
          },
          guestSnapshot: {
            select: {
              guestName: true,
              guestEmail: true,
              guestPhone: true,
            },
          },
          paymentLinks: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              tokenHash: true,
              expiresAt: true,
              status: true,
            },
          },
          payments: {
            where: { status: "VERIFIED" },
            select: {
              id: true,
              amount: true,
              currency: true,
              method: true,
              status: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });
};

/**
 * Atomically amend an existing booking.
 * Handles capacity adjustment, customer information update, notes/pickup update,
 * price recalculation, status adjustments, invoice voiding, and audit logging.
 */
export const amendBookingRecord = async (params: {
  bookingId: string;
  actorId: string;
  actorRole: string;
  previousBooking: any;
  service: any;
  customerUpdates?: { name?: string; email?: string; phone?: string | null };
  travelDateObj?: Date;
  newAvailabilityId?: string | null;
  guestDelta?: number; // difference in guests on the same date
  adults?: number;
  children?: number;
  infants?: number;
  newBasePrice: number;
  newFinalPrice: number;
  formattedNotes?: string;
  discountData?: {
    discountType: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue: number;
    discountAmount: number;
    reason: string;
  };
  changes: Record<string, any>;
}) => {
  return prisma.$transaction(async (tx) => {
    const { bookingId, actorId, actorRole, previousBooking, customerUpdates, travelDateObj, newBasePrice, newFinalPrice, formattedNotes, changes } = params;

    // 1. Update customer if details provided
    if (customerUpdates && (customerUpdates.name || customerUpdates.email || customerUpdates.phone !== undefined)) {
      await tx.user.update({
        where: { id: previousBooking.customerId },
        data: {
          ...(customerUpdates.name ? { name: customerUpdates.name } : {}),
          ...(customerUpdates.email ? { email: customerUpdates.email } : {}),
          ...(customerUpdates.phone !== undefined ? { phone: customerUpdates.phone } : {}),
        },
      });

      // Update GuestBookingSnapshot if guest booking
      if (previousBooking.isGuest) {
        await tx.guestBookingSnapshot.updateMany({
          where: { bookingId },
          data: {
            ...(customerUpdates.name ? { guestName: customerUpdates.name } : {}),
            ...(customerUpdates.email ? { guestEmail: customerUpdates.email } : {}),
            ...(customerUpdates.phone !== undefined ? { guestPhone: customerUpdates.phone } : {}),
          },
        });
      }
    }

    // 2. Adjust capacity
    let finalAvailabilityId = previousBooking.availabilityId;

    // If date changed: release old date capacity and reserve new date capacity
    if (travelDateObj && previousBooking.availability?.date && travelDateObj.getTime() !== new Date(previousBooking.availability.date).getTime()) {
      const oldGuests = Math.max(1, (previousBooking.adults ?? 1) + (previousBooking.children ?? 0) + (previousBooking.infants ?? 0));
      const newGuests = Math.max(1, (params.adults ?? 1) + (params.children ?? 0) + (params.infants ?? 0));

      // Release old capacity
      if (previousBooking.availabilityId) {
        await tx.$queryRaw`
          UPDATE "ServiceAvailability"
          SET "bookedCount" = GREATEST(0, "bookedCount" - ${oldGuests}),
              "lastVerifiedAt" = NOW()
          WHERE "id" = ${previousBooking.availabilityId}
        `;
      }

      // Upsert availability for new date
      await tx.serviceAvailability.upsert({
        where: {
          serviceId_date: {
            serviceId: previousBooking.serviceId,
            date: travelDateObj,
          },
        },
        create: {
          serviceId: previousBooking.serviceId,
          date: travelDateObj,
          isAvailable: true,
          bookedCount: 0,
          lastVerifiedAt: new Date(),
        },
        update: {},
      });

      // Atomically reserve new capacity
      const updatedList = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "ServiceAvailability"
        SET "bookedCount" = "bookedCount" + ${newGuests},
            "lastVerifiedAt" = NOW()
        WHERE "serviceId" = ${previousBooking.serviceId}
          AND "date" = ${travelDateObj}::date
          AND "isAvailable" = true
          AND ("capacity" IS NULL OR "bookedCount" + ${newGuests} <= "capacity")
        RETURNING "id"
      `;

      if (!updatedList || updatedList.length === 0) {
        throw new Error("CAPACITY_EXCEEDED");
      }

      finalAvailabilityId = updatedList[0].id;
    } else if (params.guestDelta && params.guestDelta !== 0 && previousBooking.availabilityId) {
      // Same date, but guest count changed
      if (params.guestDelta > 0) {
        const delta = params.guestDelta;
        const updatedList = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "ServiceAvailability"
          SET "bookedCount" = "bookedCount" + ${delta},
              "lastVerifiedAt" = NOW()
          WHERE "id" = ${previousBooking.availabilityId}
            AND "isAvailable" = true
            AND ("capacity" IS NULL OR "bookedCount" + ${delta} <= "capacity")
          RETURNING "id"
        `;
        if (!updatedList || updatedList.length === 0) {
          throw new Error("CAPACITY_EXCEEDED");
        }
      } else {
        const releaseCount = Math.abs(params.guestDelta);
        await tx.$queryRaw`
          UPDATE "ServiceAvailability"
          SET "bookedCount" = GREATEST(0, "bookedCount" - ${releaseCount}),
              "lastVerifiedAt" = NOW()
          WHERE "id" = ${previousBooking.availabilityId}
        `;
      }
    }

    // 3. Check payment status changes if final price changed
    let updatedPaymentStatus = previousBooking.paymentStatus;
    const paidSumResult = await tx.payment.aggregate({
      where: { bookingId, status: "VERIFIED" },
      _sum: { amount: true },
    });
    const totalPaid = Number(paidSumResult._sum.amount ?? 0);

    if (totalPaid > 0) {
      if (totalPaid >= newFinalPrice) {
        updatedPaymentStatus = "PAID";
      } else {
        updatedPaymentStatus = "PARTIALLY_PAID";
      }
    }

    // 4. Update Booking
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        basePrice: newBasePrice,
        finalPrice: newFinalPrice,
        paymentStatus: updatedPaymentStatus,
        availabilityId: finalAvailabilityId,
        ...(formattedNotes !== undefined ? { notes: formattedNotes } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        service: { select: { id: true, name: true, type: true } },
        availability: { select: { id: true, date: true } },
        assignedStaff: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, role: true } },
        discountRequests: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    // 5. If price changed, void old active tax invoices so new correct statements can be issued
    if (newFinalPrice !== Number(previousBooking.finalPrice)) {
      await tx.invoice.updateMany({
        where: { bookingId, status: "ISSUED" },
        data: { status: "VOID" },
      });
    }

    // 6. Record discount if provided
    if (params.discountData) {
      const discountRecord = await tx.staffDiscountRequest.create({
        data: {
          bookingId,
          discountType: params.discountData.discountType,
          discountValue: params.discountData.discountValue,
          originalPrice: newBasePrice,
          discountAmount: params.discountData.discountAmount,
          proposedFinalPrice: newFinalPrice,
          approvedDiscountAmount: params.discountData.discountAmount,
          approvedFinalPrice: newFinalPrice,
          status: "APPROVED",
          reason: params.discountData.reason.trim(),
          requestedById: actorId,
          reviewedById: actorId,
          reviewedAt: new Date(),
          adminNotes: "Direct amendment discount applied by staff",
        },
      });

      await tx.staffDiscountAuditEvent.create({
        data: {
          discountRequestId: discountRecord.id,
          bookingId,
          actorId,
          actorRole,
          action: "DISCOUNT_APPROVED",
          previousStatus: null,
          newStatus: "APPROVED",
          originalPrice: newBasePrice,
          discountType: params.discountData.discountType,
          discountValue: params.discountData.discountValue,
          requestedDiscountAmount: params.discountData.discountAmount,
          proposedFinalPrice: newFinalPrice,
          approvedDiscountAmount: params.discountData.discountAmount,
          finalPrice: newFinalPrice,
          reason: params.discountData.reason.trim(),
          metadata: {
            source: "BOOKING_AMENDMENT",
          },
        },
      });
    }

    // 7. Audit log in BookingHistory
    await tx.bookingHistory.create({
      data: {
        bookingId,
        actorId,
        actorRole,
        action: "BOOKING_AMENDED",
        changes,
      },
    });

    return updated;
  });
};

/**
 * Cancel a booking by staff/admin.
 * Releases reserved seats, cancels commissions, updates status to CANCELLED,
 * and logs to BookingHistory.
 */
export const cancelBookingRecord = async (params: {
  bookingId: string;
  actorId: string;
  actorRole: string;
  reason?: string;
  previousBooking: any;
}) => {
  return prisma.$transaction(async (tx) => {
    const { bookingId, actorId, actorRole, reason, previousBooking } = params;

    // 1. Release capacity
    if (previousBooking.availabilityId) {
      const guests = Math.max(1, (previousBooking.adults ?? 1) + (previousBooking.children ?? 0) + (previousBooking.infants ?? 0));
      await tx.$queryRaw`
        UPDATE "ServiceAvailability"
        SET "bookedCount" = GREATEST(0, "bookedCount" - ${guests}),
            "lastVerifiedAt" = NOW()
        WHERE "id" = ${previousBooking.availabilityId}
      `;
    }

    // 2. Void open invoices
    await tx.invoice.updateMany({
      where: { bookingId, status: "ISSUED" },
      data: { status: "VOID" },
    });

    // 3. Cancel open discount requests
    await tx.staffDiscountRequest.updateMany({
      where: { bookingId, status: "PENDING" },
      data: { status: "CANCELLED", rejectionReason: reason ?? "Booking cancelled" },
    });

    // 4. Update booking status
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
      },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        service: { select: { id: true, name: true, type: true } },
        availability: { select: { id: true, date: true } },
      },
    });

    // 5. BookingHistory
    await tx.bookingHistory.create({
      data: {
        bookingId,
        actorId,
        actorRole,
        action: "BOOKING_CANCELLED",
        changes: {
          previousStatus: previousBooking.status,
          newStatus: "CANCELLED",
          reason: reason || null,
        },
      },
    });

    return updated;
  });
};

/**
 * Global Admin Activity History across all bookings, staff, and system events.
 */
export const listAllBookingActivities = async (params: {
  bookingId?: string;
  actorId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  skip: number;
  take: number;
}) => {
  const where: any = {};

  if (params.bookingId) {
    where.bookingId = params.bookingId;
  }
  if (params.actorId) {
    where.actorId = params.actorId;
  }
  if (params.action) {
    where.action = params.action;
  }
  if (params.startDate || params.endDate) {
    where.createdAt = {};
    if (params.startDate) where.createdAt.gte = params.startDate;
    if (params.endDate) where.createdAt.lte = params.endDate;
  }
  if (params.search && params.search.trim()) {
    const q = params.search.trim();
    where.OR = [
      { bookingId: { contains: q, mode: "insensitive" } },
      { action: { contains: q, mode: "insensitive" } },
      { booking: { customer: { name: { contains: q, mode: "insensitive" } } } },
      { booking: { customer: { email: { contains: q, mode: "insensitive" } } } },
      { booking: { service: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [rawItems, total] = await Promise.all([
    prisma.bookingHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: params.skip,
      take: params.take,
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            finalPrice: true,
            currency: true,
            customer: { select: { id: true, name: true, email: true } },
            service: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.bookingHistory.count({ where }),
  ]);

  // Resolve user actor names
  const userIdsSet = new Set<string>();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const item of rawItems) {
    if (item.actorId && uuidRegex.test(item.actorId)) {
      userIdsSet.add(item.actorId);
    }
  }

  const userIds = Array.from(userIdsSet);
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, role: true, email: true },
      })
    : [];

  const userMap = new Map<string, { id: string; name: string | null; role: string; email: string }>();
  for (const u of users) {
    userMap.set(u.id, u);
  }

  const items = rawItems.map((item) => {
    const actorUser = userMap.get(item.actorId);
    const isSystem = item.action.startsWith("STRIPE_") || item.action === "BOOKING_AUTO_CONFIRMED";
    return {
      id: item.id,
      bookingId: item.bookingId,
      actorId: item.actorId,
      actorName: actorUser?.name || (isSystem ? "Automated System" : null),
      actorEmail: actorUser?.email || null,
      actorRole: item.actorRole,
      action: item.action,
      changes: item.changes,
      createdAt: item.createdAt,
      booking: item.booking,
    };
  });

  return { items, total };
};

