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

  const formattedItems = items.map((b) => ({
    ...b,
    basePrice: toNumber(b.basePrice) ?? 0,
    finalPrice: toNumber(b.finalPrice) ?? 0,
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
    select: customerBookingSelect,
  });

  if (!booking) return null;

  return {
    ...booking,
    basePrice: toNumber(booking.basePrice) ?? 0,
    finalPrice: toNumber(booking.finalPrice) ?? 0,
  };
};
