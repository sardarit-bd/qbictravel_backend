import AppError from "../../shared/utils/AppError.js";
import { parseEnumQuery, parsePagination, parseUuidQuery } from "../../shared/utils/pagination.js";
import * as paymentRepository from "./paymentRepository.js";
import { PAYMENT_METHODS, PAYMENT_RECORD_STATUSES } from "./paymentTypes.js";
import type {
  CreatePaymentInput,
  PaymentFilters,
  RecordPaymentInput,
  VerifyPaymentInput,
} from "./paymentTypes.js";

const toCents = (value: unknown): number => Math.round(Number(value) * 100);

const PAYABLE_BOOKING_STATUSES: string[] = ["PENDING", "CONFIRMED"];

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === code;

const mapPayment = (payment: any) => ({
  ...payment,
  amount: Number(payment.amount),
  booking: payment.booking
    ? { ...payment.booking, finalPrice: Number(payment.booking.finalPrice) }
    : undefined,
});

const getPaymentOr404 = async (paymentId: string) => {
  const payment = await paymentRepository.findPaymentById(paymentId);
  if (!payment) {
    throw new AppError("Payment not found", 404);
  }
  return payment;
};

const listWithFilters = async (base: PaymentFilters, query: Record<string, unknown>, allowIdFilters: boolean) => {
  const { page, limit, skip } = parsePagination(query);
  const filters: PaymentFilters = {
    ...base,
    status: parseEnumQuery(query.status, PAYMENT_RECORD_STATUSES, "status"),
    method: parseEnumQuery(query.method, PAYMENT_METHODS, "method"),
    ...(allowIdFilters
      ? {
          bookingId: parseUuidQuery(query.bookingId, "bookingId"),
          customerId: parseUuidQuery(query.customerId, "customerId"),
        }
      : {}),
  };

  const { items, total } = await paymentRepository.listPayments(filters, skip, limit);
  return { items: items.map(mapPayment), page, limit, total };
};

export const createPayment = async (customerId: string, bookingId: string, input: CreatePaymentInput) => {
  const booking = await paymentRepository.findBookingForPayment(bookingId);

  if (!booking || booking.customerId !== customerId) {
    throw new AppError("Booking not found", 404);
  }

  if (booking.requiresApproval || !PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new AppError("This booking cannot accept a payment in its current state", 409);
  }

  if (booking.paymentStatus !== "UNPAID") {
    throw new AppError("This booking is already paid", 409);
  }

  const amountCents = toCents(booking.finalPrice);
  if (amountCents <= 0) {
    throw new AppError("This booking has no payable amount", 409);
  }

  let payment;
  try {
    payment = await paymentRepository.createPaymentIfNoneActive({
      bookingId,
      customerId,
      amount: amountCents / 100,
      method: input.method,
      status: input.reference ? "SUBMITTED" : "INITIATED",
      reference: input.reference,
      receiptNote: input.receiptNote,
    });
  } catch (error) {
    if (hasCode(error, "P2002")) {
      throw new AppError("This payment reference has already been used", 409);
    }
    if (hasCode(error, "P2034")) {
      throw new AppError("The payment could not be created right now. Please retry.", 409);
    }
    throw error;
  }

  if (!payment) {
    throw new AppError("This booking already has an active payment", 409);
  }

  return mapPayment(payment);
};

export const listCustomerPayments = async (customerId: string, query: Record<string, unknown>) =>
  listWithFilters({ customerId }, query, false);

export const getCustomerPayment = async (customerId: string, paymentId: string) => {
  const payment = await getPaymentOr404(paymentId);
  if (payment.customerId !== customerId) {
    throw new AppError("Payment not found", 404);
  }
  return mapPayment(payment);
};

export const listAgentPayments = async (agentId: string, query: Record<string, unknown>) =>
  listWithFilters({ agentId }, query, false);

export const listAdminPayments = async (query: Record<string, unknown>) => listWithFilters({}, query, true);

export const getAdminPayment = async (paymentId: string) => mapPayment(await getPaymentOr404(paymentId));

export const verifyPayment = async (adminId: string, paymentId: string, input: VerifyPaymentInput) => {
  const payment = await getPaymentOr404(paymentId);

  if (payment.status !== "SUBMITTED") {
    throw new AppError("Only a payment with a submitted receipt can be verified", 409);
  }

  const amountCents = toCents(payment.amount);

  if (input.decision === "VERIFIED" && amountCents !== toCents(payment.booking.finalPrice)) {
    throw new AppError("The payment amount no longer matches the booking price", 409);
  }

  const updated = await paymentRepository.transitionPayment({
    paymentId,
    bookingId: payment.bookingId,
    amount: amountCents / 100,
    fromStatus: "SUBMITTED",
    toStatus: input.decision,
    adminId,
    notes: input.notes,
    action: input.decision === "VERIFIED" ? "PAYMENT_VERIFIED" : "PAYMENT_REJECTED",
    changes: {
      paymentId,
      amount: amountCents / 100,
      method: payment.method,
      reference: payment.reference,
      previousStatus: payment.status,
      newStatus: input.decision,
      notes: input.notes ?? null,
    },
  });

  if (!updated) {
    throw new AppError("The payment was changed by someone else. Please reload and retry.", 409);
  }

  return mapPayment(updated);
};

export const recordPayment = async (adminId: string, paymentId: string, input: RecordPaymentInput) => {
  const payment = await getPaymentOr404(paymentId);

  if (payment.status !== "INITIATED") {
    throw new AppError("Only an initiated payment can be recorded. Use verify for submitted receipts.", 409);
  }

  const amountCents = toCents(payment.amount);
  if (amountCents !== toCents(payment.booking.finalPrice)) {
    throw new AppError("The payment amount no longer matches the booking price", 409);
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime()) || receivedAt.getTime() > Date.now() + 60_000) {
    throw new AppError("The received date cannot be in the future", 400);
  }

  let updated;
  try {
    updated = await paymentRepository.transitionPayment({
      paymentId,
      bookingId: payment.bookingId,
      amount: amountCents / 100,
      fromStatus: "INITIATED",
      toStatus: "VERIFIED",
      adminId,
      notes: input.notes,
      reference: input.reference,
      receivedAt,
      action: "PAYMENT_RECORDED",
      changes: {
        paymentId,
        amount: amountCents / 100,
        method: payment.method,
        reference: input.reference ?? payment.reference,
        receivedAt: receivedAt.toISOString(),
        notes: input.notes ?? null,
      },
    });
  } catch (error) {
    if (hasCode(error, "P2002")) {
      throw new AppError("This payment reference has already been used", 409);
    }
    throw error;
  }

  if (!updated) {
    throw new AppError("The payment was changed by someone else. Please reload and retry.", 409);
  }

  return mapPayment(updated);
};