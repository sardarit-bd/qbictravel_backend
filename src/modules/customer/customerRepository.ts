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

  return {
    ...b,
    availability,
    basePrice: toNumber(b.basePrice) ?? 0,
    finalPrice: toNumber(b.finalPrice) ?? 0,
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
      select: customerBookingSelect,
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
