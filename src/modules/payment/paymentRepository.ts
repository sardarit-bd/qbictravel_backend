import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import type { PaymentFilters, PaymentMethodValue } from "./paymentTypes.js";
import { createCommissionForBooking } from "../commission/commissionRepository.js";
type HistoryChanges = Record<string, string | number | boolean | null>;

const ACTIVE_STATUSES: ("INITIATED" | "SUBMITTED" | "VERIFIED")[] = ["INITIATED", "SUBMITTED", "VERIFIED"];
const PAYABLE_BOOKING_STATUSES: ("PENDING" | "CONFIRMED")[] = ["PENDING", "CONFIRMED"];

const paymentInclude = {
  booking: {
    select: {
      id: true,
      serviceId: true,
      agentId: true,
      status: true,
      paymentStatus: true,
      finalPrice: true,
    },
  },
} as const;

export const findBookingForPayment = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      customerId: true,
      status: true,
      requiresApproval: true,
      paymentStatus: true,
      finalPrice: true,
    },
  });
};

export const createPaymentIfNoneActive = async (params: {
  bookingId: string;
  customerId: string;
  amount: number;
  method: PaymentMethodValue;
  status: "INITIATED" | "SUBMITTED";
  reference?: string;
  receiptNote?: string;
}) => {
  return prisma.$transaction(
    async (tx) => {
      const active = await tx.payment.count({
        where: { bookingId: params.bookingId, status: { in: ACTIVE_STATUSES } },
      });

      if (active > 0) {
        return null;
      }

      const payment = await tx.payment.create({
        data: {
          bookingId: params.bookingId,
          customerId: params.customerId,
          amount: params.amount,
          method: params.method,
          status: params.status,
          reference: params.reference ?? null,
          receiptNote: params.receiptNote ?? null,
          submittedAt: params.status === "SUBMITTED" ? new Date() : null,
        },
      });

      await tx.bookingHistory.create({
        data: {
          bookingId: params.bookingId,
          actorId: params.customerId,
          actorRole: "customer",
          action: params.status === "SUBMITTED" ? "PAYMENT_SUBMITTED" : "PAYMENT_INITIATED",
          changes: {
            paymentId: payment.id,
            amount: params.amount,
            method: params.method,
            reference: params.reference ?? null,
          },
        },
      });

      return payment;
    },
    { isolationLevel: "Serializable" },
  );
};

export const findPaymentById = async (paymentId: string) => {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: paymentInclude,
  });
};

export const listPayments = async (filters: PaymentFilters, skip: number, take: number) => {
  const where = {
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.agentId ? { booking: { agentId: filters.agentId } } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.method ? { method: filters.method } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.payment.count({ where }),
  ]);

  return { items, total };
};

export const transitionPayment = async (params: {
  paymentId: string;
  bookingId: string;
  amount: number;
  fromStatus: "INITIATED" | "SUBMITTED";
  toStatus: "VERIFIED" | "REJECTED";
  adminId: string;
  notes?: string;
  reference?: string;
  receivedAt?: Date;
  action: string;
  changes: HistoryChanges;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: params.paymentId, status: params.fromStatus },
      data: {
        status: params.toStatus,
        reviewedById: params.adminId,
        reviewedAt: new Date(),
        reviewNotes: params.notes ?? null,
        ...(params.reference ? { reference: params.reference } : {}),
        ...(params.receivedAt ? { receivedAt: params.receivedAt } : {}),
      },
    });

    if (updated.count === 0) {
      return null;
    }

    if (params.toStatus === "VERIFIED") {
      const booking = await tx.booking.updateMany({
        where: {
          id: params.bookingId,
          paymentStatus: "UNPAID",
          requiresApproval: false,
          status: { in: PAYABLE_BOOKING_STATUSES },
          finalPrice: params.amount,
        },
        data: { paymentStatus: "PAID" },
      });

      if (booking.count === 0) {
        throw new AppError("The booking can no longer accept this payment", 409);
      }

      await createCommissionForBooking(tx, params.bookingId);
    }

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.adminId,
        actorRole: "admin",
        action: params.action,
        changes: params.changes,
      },
    });

    return tx.payment.findUniqueOrThrow({
      where: { id: params.paymentId },
      include: paymentInclude,
    });
  });
};