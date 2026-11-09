import AppError from "../../shared/utils/AppError.js";
import { parseEnumQuery, parsePagination, parseUuidQuery } from "../../shared/utils/pagination.js";
import * as paymentRepository from "./paymentRepository.js";
import { PAYMENT_METHODS, PAYMENT_RECORD_STATUSES } from "./paymentTypes.js";
import type {
  CreatePaymentInput,
  PaymentFilters,
  RecordPaymentInput,
  VerifyPaymentInput,
  CreateStripeSessionInput,
  StripeCheckoutSessionResult,
  WebhookProcessingResult,
  PaymentReconciliationResult,
} from "./paymentTypes.js";
import * as notificationService from "../notification/notificationService.js";
import { toStripeAmount, fromStripeAmount } from "../../shared/utils/currencyUtils.js";
import { StripeHttpClient, verifyWebhookSignature, type IStripeClient, type StripeEventPayload } from "./stripeClient.js";
import logger from "../../shared/logger/logger.js";
import env from "../../config/env.js";

const toCents = (value: unknown): number => Math.round(Number(value) * 100);

const PAYABLE_BOOKING_STATUSES: string[] = ["PENDING", "CONFIRMED"];

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === code;

const mapPayment = (payment: any) => ({
  ...payment,
  amount: Number(payment.amount),
  booking: payment.booking
    ? {
        ...payment.booking,
        finalPrice: Number(payment.booking.finalPrice),
        service: payment.booking.service,
      }
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

// Default Stripe client instance (can be overridden via dependency injection for testing)
let activeStripeClient: IStripeClient = new StripeHttpClient();

export const setStripeClient = (client: IStripeClient) => {
  activeStripeClient = client;
};

/**
 * Creates or reuses a Stripe Checkout Session for a booking.
 * Enforces:
 * - Server-authoritative booking amount and currency (never trust client amounts).
 * - Safe retry if existing attempt is expired or failed.
 * - Prevents multiple active sessions.
 */
export const resolveStripeSessionUrls = (
  bookingId: string,
  inputUrls?: { successUrl?: string; cancelUrl?: string },
  frontendOriginOverride?: string,
  isProductionOverride?: boolean,
): { successUrl: string; cancelUrl: string } => {
  const origin = frontendOriginOverride !== undefined ? frontendOriginOverride : env.frontendUrl;
  const isProd = isProductionOverride !== undefined ? isProductionOverride : env.nodeEnv === "production";

  if (!origin || typeof origin !== "string" || !origin.trim()) {
    throw new AppError("Frontend application origin (FRONTEND_URL) is not configured", 500);
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin.trim());
  } catch {
    throw new AppError(`Invalid FRONTEND_URL origin configuration: "${origin}". Must be an absolute URL`, 500);
  }

  if (isProd && parsedOrigin.protocol !== "https:") {
    throw new AppError(`Invalid FRONTEND_URL origin configuration: "${origin}". Production environment requires HTTPS`, 500);
  }

  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    throw new AppError(`Invalid FRONTEND_URL origin configuration: "${origin}". Protocol must be HTTP or HTTPS`, 500);
  }

  const cleanBase = origin.trim().replace(/\/+$/, "");

  // If user passed explicit successUrl, use it; otherwise generate standard URL with {CHECKOUT_SESSION_ID} preserved
  const successUrl =
    inputUrls?.successUrl && inputUrls.successUrl.trim()
      ? inputUrls.successUrl.trim()
      : `${cleanBase}/checkout/success?session_id={CHECKOUT_SESSION_ID}&bookingId=${bookingId}`;

  const cancelUrl =
    inputUrls?.cancelUrl && inputUrls.cancelUrl.trim()
      ? inputUrls.cancelUrl.trim()
      : `${cleanBase}/checkout/cancel?bookingId=${bookingId}`;

  return { successUrl, cancelUrl };
};

export const createStripeCheckoutSession = async (
  customerId: string,
  input: CreateStripeSessionInput,
): Promise<StripeCheckoutSessionResult> => {
  const booking = await paymentRepository.findBookingForPayment(input.bookingId);

  if (!booking || booking.customerId !== customerId) {
    throw new AppError("Booking not found", 404);
  }

  if (booking.requiresApproval || !PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new AppError("This booking cannot accept a payment in its current state", 409);
  }

  if (booking.paymentStatus === "PAID") {
    throw new AppError("This booking is already paid", 409);
  }

  const finalPrice = Number(booking.finalPrice);
  if (finalPrice <= 0) {
    throw new AppError("This booking has no payable amount", 409);
  }

  const amountMinor = toStripeAmount(finalPrice, booking.currency);
  const { successUrl, cancelUrl } = resolveStripeSessionUrls(booking.id, {
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });

  const { payment, isAlreadyVerified, isExistingActive } = await paymentRepository.createOrGetStripePayment({
    bookingId: booking.id,
    customerId,
    amount: finalPrice,
    currency: booking.currency,
  });

  if (isAlreadyVerified) {
    throw new AppError("This booking is already paid", 409);
  }

  // If there is an existing active session, check if it's still open on Stripe
  if (isExistingActive && payment.stripeSessionId) {
    try {
      const existingSession = await activeStripeClient.retrieveCheckoutSession(payment.stripeSessionId);
      if (existingSession.status === "open") {
        return {
          sessionId: existingSession.id,
          sessionUrl: existingSession.url,
          paymentId: payment.id,
          amount: finalPrice,
          currency: booking.currency,
          status: payment.status,
        };
      }
      // If it's expired or completed, mark local record accordingly
      if (existingSession.status === "expired") {
        await paymentRepository.updateStripePaymentStatus({
          paymentId: payment.id,
          bookingId: booking.id,
          status: "CANCELLED",
          failureReason: "Stripe checkout session expired",
        });
      }
    } catch (err: any) {
      logger.warn({ err: err.message, sessionId: payment.stripeSessionId }, "Could not retrieve existing Stripe session");
    }
  }

  // Create new Checkout Session on Stripe
  const serviceTitle = (booking as any).service?.name || "Tour Experience";
  const customerEmail = (booking as any).customer?.email;

  const session = await activeStripeClient.createCheckoutSession({
    bookingId: booking.id,
    customerId,
    amountMinor,
    currency: booking.currency,
    customerEmail,
    serviceTitle,
    successUrl,
    cancelUrl,
    idempotencyKey: `checkout_${payment.id}`,
  });

  await paymentRepository.updatePaymentStripeSession(payment.id, session.id, session.payment_intent);

  return {
    sessionId: session.id,
    sessionUrl: session.url,
    paymentId: payment.id,
    amount: finalPrice,
    currency: booking.currency,
    status: "INITIATED",
  };
};

/**
 * Handles incoming raw Stripe Webhook requests with cryptographic signature verification,
 * event recording, worker locking, and idempotent state transitions.
 */
export const handleStripeWebhook = async (
  rawBody: Buffer | string,
  signatureHeader: string,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "",
): Promise<WebhookProcessingResult> => {
  // 1. Verify signature
  const isValid = verifyWebhookSignature(rawBody, signatureHeader, webhookSecret);
  if (!isValid) {
    logger.warn("Invalid Stripe webhook signature");
    throw new AppError("Invalid Stripe webhook signature", 400);
  }

  const payload: StripeEventPayload = JSON.parse(
    Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody,
  );
  const eventId = payload.id;
  const eventType = payload.type;
  const object = payload.data?.object || {};

  const bookingId = (object.metadata?.bookingId || object.client_reference_id) as string | undefined;

  // 2. Persist event in StripeWebhookEvent
  const { event, isDuplicate } = await paymentRepository.recordWebhookEventReceived({
    eventId,
    type: eventType,
    payload,
    bookingId,
  });

  if (isDuplicate && event.status === "PROCESSED") {
    logger.info({ eventId, eventType }, "Duplicate Stripe webhook event already processed");
    return {
      received: true,
      eventId,
      type: eventType,
      status: "PROCESSED",
      message: "Duplicate event already processed",
    };
  }

  // 3. Concurrency Lock
  const workerId = `webhook-${process.pid}-${Date.now()}`;
  const lockedEvent = await paymentRepository.lockWebhookEventForProcessing(eventId, workerId);
  if (!lockedEvent) {
    return {
      received: true,
      eventId,
      type: eventType,
      status: event.status === "PROCESSED" ? "PROCESSED" : "FAILED",
      message: "Event is currently locked by another worker or already finalized",
    };
  }

  try {
    let paymentId: string | undefined;

    switch (eventType) {
      // Successful Checkout
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const sessionId = object.id;
        const paymentIntentId = object.payment_intent;
        const targetBookingId = object.metadata?.bookingId || object.client_reference_id;
        const currency = (object.currency || "thb").toUpperCase();
        const amountMinor = object.amount_total || 0;
        const amount = fromStripeAmount(amountMinor, currency);

        if (!targetBookingId) {
          logger.warn({ eventId, sessionId }, "Checkout session completed without bookingId");
          await paymentRepository.completeWebhookEvent(eventId, "IGNORED");
          return { received: true, eventId, type: eventType, status: "IGNORED" };
        }

        let targetPayment = await paymentRepository.findPaymentByStripeSessionId(sessionId);
        if (!targetPayment) {
          targetPayment = await paymentRepository.findActiveStripePaymentForBooking(targetBookingId);
        }

        if (!targetPayment) {
          // Check if already verified
          const existingVerified = await paymentRepository.findVerifiedPaymentForBooking(targetBookingId);
          if (existingVerified) {
            await paymentRepository.completeWebhookEvent(eventId, "PROCESSED", targetBookingId, existingVerified.id);
            return {
              received: true,
              eventId,
              type: eventType,
              status: "PROCESSED",
              bookingId: targetBookingId,
              paymentId: existingVerified.id,
            };
          }
          throw new AppError(`No matching payment record found for session ${sessionId} and booking ${targetBookingId}`, 404);
        }

        paymentId = targetPayment.id;

        const result = await paymentRepository.verifyStripePaymentAtomically({
          paymentId: targetPayment.id,
          bookingId: targetBookingId,
          amount,
          currency,
          stripePaymentIntentId: paymentIntentId,
          stripeSessionId: sessionId,
        });

        await paymentRepository.completeWebhookEvent(eventId, "PROCESSED", targetBookingId, targetPayment.id);

        return {
          received: true,
          eventId,
          type: eventType,
          status: "PROCESSED",
          bookingId: targetBookingId,
          paymentId: targetPayment.id,
          message: result.isDuplicateSuccess ? "Payment was already verified" : "Payment verified successfully",
        };
      }

      // Checkout Session Expired
      case "checkout.session.expired": {
        const sessionId = object.id;
        const targetPayment = await paymentRepository.findPaymentByStripeSessionId(sessionId);
        if (targetPayment) {
          paymentId = targetPayment.id;
          await paymentRepository.updateStripePaymentStatus({
            paymentId: targetPayment.id,
            bookingId: targetPayment.bookingId,
            status: "CANCELLED",
            failureReason: "Stripe checkout session expired",
          });
        }
        await paymentRepository.completeWebhookEvent(eventId, "PROCESSED", targetPayment?.bookingId, targetPayment?.id);
        return { received: true, eventId, type: eventType, status: "PROCESSED", paymentId };
      }

      // Async payment failed
      case "checkout.session.async_payment_failed": {
        const sessionId = object.id;
        const targetPayment = await paymentRepository.findPaymentByStripeSessionId(sessionId);
        if (targetPayment) {
          paymentId = targetPayment.id;
          await paymentRepository.updateStripePaymentStatus({
            paymentId: targetPayment.id,
            bookingId: targetPayment.bookingId,
            status: "FAILED",
            failureReason: "Stripe async payment failed",
          });
        }
        await paymentRepository.completeWebhookEvent(eventId, "PROCESSED", targetPayment?.bookingId, targetPayment?.id);
        return { received: true, eventId, type: eventType, status: "PROCESSED", paymentId };
      }

      // PaymentIntent succeeded
      case "payment_intent.succeeded": {
        const paymentIntentId = object.id;
        const targetBookingId = object.metadata?.bookingId;
        const currency = (object.currency || "thb").toUpperCase();
        const amountMinor = object.amount || 0;
        const amount = fromStripeAmount(amountMinor, currency);

        const targetPayment = await paymentRepository.findPaymentByStripePaymentIntentId(paymentIntentId);
        if (targetPayment && targetBookingId) {
          paymentId = targetPayment.id;
          await paymentRepository.verifyStripePaymentAtomically({
            paymentId: targetPayment.id,
            bookingId: targetBookingId,
            amount,
            currency,
            stripePaymentIntentId: paymentIntentId,
          });
        }
        await paymentRepository.completeWebhookEvent(eventId, "PROCESSED", targetBookingId, targetPayment?.id);
        return { received: true, eventId, type: eventType, status: "PROCESSED", paymentId };
      }

      // PaymentIntent payment failed
      case "payment_intent.payment_failed": {
        const paymentIntentId = object.id;
        const failureMessage = object.last_payment_error?.message || "Payment attempt failed";
        const targetPayment = await paymentRepository.findPaymentByStripePaymentIntentId(paymentIntentId);
        if (targetPayment) {
          paymentId = targetPayment.id;
          await paymentRepository.updateStripePaymentStatus({
            paymentId: targetPayment.id,
            bookingId: targetPayment.bookingId,
            status: "FAILED",
            failureReason: failureMessage,
            stripePaymentIntentId: paymentIntentId,
          });
        }
        await paymentRepository.completeWebhookEvent(eventId, "PROCESSED", targetPayment?.bookingId, targetPayment?.id);
        return { received: true, eventId, type: eventType, status: "PROCESSED", paymentId };
      }

      default:
        // Unhandled event types are safely ignored
        await paymentRepository.completeWebhookEvent(eventId, "IGNORED", bookingId);
        return { received: true, eventId, type: eventType, status: "IGNORED" };
    }
  } catch (error: any) {
    logger.error({ eventId, eventType, err: error.message }, "Stripe webhook handling failed");
    await paymentRepository.failWebhookEvent(eventId, error.message || "Unknown error");
    throw error;
  }
};

/**
 * Reconciles a payment attempt against Stripe's authoritative API.
 * Used for recovering missed webhooks, checking status on user return from Checkout,
 * or periodic reconciliation jobs.
 */
export const reconcileStripePayment = async (
  paymentId: string,
  requester?: { id: string; role: string },
): Promise<PaymentReconciliationResult> => {
  const payment = await getPaymentOr404(paymentId);

  // If customer is requesting reconciliation, verify ownership
  if (requester && requester.role === "customer" && payment.customerId !== requester.id) {
    throw new AppError("Payment not found", 404);
  }

  if (payment.method !== "STRIPE") {
    throw new AppError("Only Stripe payments can be reconciled against Stripe API", 400);
  }

  const previousStatus = payment.status;

  // Never downgrade a verified payment
  if (previousStatus === "VERIFIED") {
    return {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      previousStatus,
      newStatus: previousStatus,
      reconciled: true,
      notes: "Payment is already verified locally",
    };
  }

  if (!payment.stripeSessionId && !payment.stripePaymentIntentId) {
    return {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      previousStatus,
      newStatus: previousStatus,
      reconciled: false,
      notes: "No Stripe session or PaymentIntent ID recorded",
    };
  }

  let session: any;
  if (payment.stripeSessionId) {
    try {
      session = await activeStripeClient.retrieveCheckoutSession(payment.stripeSessionId);
    } catch (err: any) {
      logger.warn({ err: err.message, sessionId: payment.stripeSessionId }, "Reconciliation: failed to retrieve session");
    }
  }

  if (session) {
    if (session.payment_status === "paid" || session.status === "complete") {
      const currency = (session.currency || payment.currency).toUpperCase();
      const amount = fromStripeAmount(session.amount_total || 0, currency);

      const verified = await paymentRepository.verifyStripePaymentAtomically({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        amount,
        currency,
        stripePaymentIntentId: session.payment_intent,
        stripeSessionId: session.id,
      });

      return {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        previousStatus,
        newStatus: verified.payment.status,
        reconciled: true,
        notes: "Recovered and verified via Stripe Checkout Session retrieval",
      };
    }

    if (session.status === "expired") {
      const updated = await paymentRepository.updateStripePaymentStatus({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        status: "CANCELLED",
        failureReason: "Stripe checkout session expired",
      });
      return {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        previousStatus,
        newStatus: updated?.status || "CANCELLED",
        reconciled: true,
        notes: "Session expired on Stripe",
      };
    }
  }

  return {
    paymentId: payment.id,
    bookingId: payment.bookingId,
    previousStatus,
    newStatus: previousStatus,
    reconciled: false,
    notes: "No state change detected on Stripe",
  };
};

// ==========================================
// Existing Manual Payment Methods (Preserved)
// ==========================================

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
      currency: booking.currency,
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

  await notificationService.notifyPaymentDecision(
    payment.bookingId,
    input.decision === "VERIFIED" ? "CONFIRMED" : "REJECTED",
  );

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

  await notificationService.notifyPaymentDecision(payment.bookingId, "CONFIRMED");

  return mapPayment(updated);
};
