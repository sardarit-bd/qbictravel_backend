import { prisma } from "../../lib/prisma.js";

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "AWAITING_APPROVAL"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export interface ListCustomerBookingsParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

/**
 * Customer-safe booking shape.
 *
 * Unlike the agent booking DTO, we intentionally:
 * - do NOT include the customer's own contact details (they know them, and the
 *   backend must not re-expose another customer's info),
 * - do NOT include `commission` (agent-only financials),
 * - do NOT include `proposedPrice` / `priceApproval` (negotiation fields
 *   used by agents),
 * - do NOT expose the owning `customerId` / `agentId` foreign keys.
 */
const customerBookingSelect = {
  id: true,
  status: true,
  paymentStatus: true,
  fulfillmentStatus: true,
  currency: true,
  basePrice: true,
  finalPrice: true,
  packageId: true,
  packageQuantity: true,
  packagePriceSnapshot: true,
  timeSlotId: true,
  departureTime: true,
  pickupZoneId: true,
  pickupLocation: true,
  pickupSurcharge: true,
  taxAmount: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  service: {
    select: {
      id: true,
      name: true,
      description: true,
      type: true,
      media: {
        select: {
          secureUrl: true,
        },
        take: 1,
        orderBy: { createdAt: "asc" },
      },
    },
  },
  package: {
    select: {
      id: true,
      name: true,
      durationMinutes: true,
      boatSize: true,
      maxCapacity: true,
      sellingPrice: true,
      currency: true,
    },
  },
  timeSlot: {
    select: {
      id: true,
      name: true,
      departureTime: true,
    },
  },
  pickupZone: {
    select: {
      id: true,
      zoneName: true,
      morningPickupTime: true,
      afternoonPickupTime: true,
    },
  },
  availability: {
    select: {
      id: true,
      date: true,
    },
  },
} as const;

const toNumber = (value: unknown): number | null =>
  value == null ? null : Number(value);

const parseTravelDateFromNotes = (notes?: string | null): string | null => {
  if (!notes || typeof notes !== "string") return null;
  const match = notes.match(/Travel Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return match ? match[1] : null;
};

const formatBookingItem = (b: any) => {
  const fallbackDate = parseTravelDateFromNotes(b.notes);
  const availability =
    b.availability && b.availability.date
      ? b.availability
      : fallbackDate
      ? { id: `notes-date-${b.id}`, date: new Date(fallbackDate) }
      : null;

  const finalPrice = toNumber(b.finalPrice) ?? 0;
  const verifiedPaid = Array.isArray(b.payments)
    ? b.payments
        .filter((p: any) => p.status === "VERIFIED" || p.status === "PAID")
        .reduce((sum: number, p: any) => sum + (toNumber(p.amount) ?? 0), 0)
    : 0;
  const paidAmount =
    b.paymentStatus === "PAID" ? Math.max(finalPrice, verifiedPaid) : verifiedPaid;
  const outstandingBalance =
    b.paymentStatus === "PAID"
      ? 0
      : Math.max(0, Math.round((finalPrice - paidAmount) * 100) / 100);

  return {
    ...b,
    availability,
    basePrice: toNumber(b.basePrice) ?? 0,
    finalPrice,
    paidAmount,
    outstandingBalance,
    packageQuantity: b.packageQuantity ?? 1,
    packagePriceSnapshot: toNumber(b.packagePriceSnapshot),
    pickupSurcharge: toNumber(b.pickupSurcharge) ?? 0,
    taxAmount: toNumber(b.taxAmount) ?? 0,
    package: b.package
      ? {
          ...b.package,
          sellingPrice: toNumber(b.package.sellingPrice) ?? 0,
        }
      : null,
  };
};

export const listCustomerBookings = async (
  customerId: string,
  params: ListCustomerBookingsParams
) => {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(params.limit) || 10));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {
    customerId,
  };

  if (params.status && params.status !== "ALL") {
    where.status = params.status;
  }

  if (params.search && params.search.trim()) {
    const query = params.search.trim();
    where.OR = [
      { id: { contains: query, mode: "insensitive" } },
      { service: { name: { contains: query, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: {
        ...customerBookingSelect,
        payments: {
          where: { status: "VERIFIED" },
          select: { amount: true, status: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  const formattedItems = items.map(formatBookingItem);

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

export const findCustomerBookingById = async (
  customerId: string,
  bookingId: string
) => {
  // Scope by both id and customerId so another customer's booking reads as 404.
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      customerId,
    },
    select: {
      ...customerBookingSelect,
      payments: {
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          reference: true,
          stripeSessionId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!booking) return null;

  return {
    ...formatBookingItem(booking),
    payments: (booking.payments || []).map((p: any) => ({
      ...p,
      amount: toNumber(p.amount) ?? 0,
    })),
  };
};
