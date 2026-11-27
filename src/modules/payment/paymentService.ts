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
import { defaultPayPalClient, type PayPalOrderResponse } from "./paypalClient.js";
import { defaultOmiseClient, OmiseClient, OmiseError, type OmiseChargeResponse } from "./omiseClient.js";
import { prisma } from "../../lib/prisma.js";
import { recordAffiliateCommissionReversal } from "../affiliate/affiliateCommissionService.js";
import { generateSecureToken, hashToken } from "./tokenUtils.js";
import logger from "../../shared/logger/logger.js";
import env from "../../config/env.js";
import { emitPaymentEvent, emitBookingEvent } from "../event/eventEmitter.js";
import { isOmiseGatewayEnabled } from "../setting/settingRuntimeConfig.js";

const toCents = (value: unknown): number => Math.round(Number(value) * 100);

const PAYABLE_BOOKING_STATUSES: string[] = ["PENDING", "CONFIRMED", "IN_PROGRESS"];

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
    ...(query.bookingId ? { bookingId: parseUuidQuery(query.bookingId, "bookingId") } : {}),
    ...(allowIdFilters
      ? {
          bookingId: parseUuidQuery(query.bookingId, "bookingId"),
          customerId: parseUuidQuery(query.customerId, "customerId"),
          agentId: parseUuidQuery(query.agentId, "agentId"),
          source: query.source as any,
        }
      : {}),
  };

  const { items, total } = await paymentRepository.listPayments(filters, skip, limit);
  return { items: items.map(mapPayment), page, limit, total };
};

// Default Stripe client instance (can be overridden via dependency injection for testing)
let activeStripeClient: IStripeClient = new StripeHttpClient();
let activeOmiseClient: OmiseClient = defaultOmiseClient;

export const setStripeClient = (client: IStripeClient) => {
  activeStripeClient = client;
};

export const setOmiseClient = (client: OmiseClient) => {
  activeOmiseClient = client;
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

        emitPaymentEvent("payment.verified", targetPayment.id).catch((err) =>
          logger.error({ paymentId: targetPayment.id, err }, "Failed to emit payment.verified event")
        );
        emitBookingEvent("booking.status_changed", targetBookingId, {
          paymentStatus: "PAID",
        }).catch((err) =>
          logger.error({ bookingId: targetBookingId, err }, "Failed to emit booking.status_changed event")
        );

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

      // Charge refunded (full or partial Stripe refund)
      case "charge.refunded": {
        const paymentIntentId = typeof object.payment_intent === "string" ? object.payment_intent : null;
        const currency = (object.currency || "thb").toUpperCase();
        const targetPayment = paymentIntentId
          ? await paymentRepository.findPaymentByStripePaymentIntentId(paymentIntentId)
          : null;

        if (targetPayment) {
          paymentId = targetPayment.id;
          const refundsList: Array<{ id?: string; amount?: number; reason?: string }> =
            Array.isArray(object.refunds?.data) && object.refunds.data.length > 0
              ? object.refunds.data
              : [{ id: eventId, amount: object.amount_refunded || 0 }];

          await prisma.$transaction(async (tx) => {
            for (const ref of refundsList) {
              const refundAmount = fromStripeAmount(ref.amount || 0, currency);
              if (refundAmount > 0) {
                await recordAffiliateCommissionReversal(tx, {
                  bookingId: targetPayment.bookingId,
                  paymentId: targetPayment.id,
                  refundId: ref.id || eventId,
                  refundAmount,
                  currency,
                  reason: ref.reason || "Stripe charge.refunded webhook",
                });
              }
            }
          });
        }

        await paymentRepository.completeWebhookEvent(
          eventId,
          "PROCESSED",
          targetPayment?.bookingId,
          targetPayment?.id
        );

        if (targetPayment) {
          emitPaymentEvent("payment.refunded", targetPayment.id).catch((err) =>
            logger.error({ paymentId: targetPayment.id, err }, "Failed to emit payment.refunded event")
          );
          emitBookingEvent("booking.updated", targetPayment.bookingId).catch((err) =>
            logger.error({ bookingId: targetPayment.bookingId, err }, "Failed to emit booking.updated event")
          );
        }

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

  // If agent is requesting reconciliation, verify booking ownership
  if (requester && requester.role === "agent" && payment.booking?.agentId !== requester.id) {
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

export const createAgentPayment = async (agentId: string, bookingId: string, input: CreatePaymentInput) => {
  const booking = await paymentRepository.findBookingForPayment(bookingId);

  if (!booking || (booking as any).agentId !== agentId) {
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
      customerId: booking.customerId,
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

export const createAgentStripeCheckoutSession = async (
  agentId: string,
  input: CreateStripeSessionInput,
): Promise<StripeCheckoutSessionResult> => {
  const booking = await paymentRepository.findBookingForPayment(input.bookingId);

  if (!booking || (booking as any).agentId !== agentId) {
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
    customerId: booking.customerId,
    amount: finalPrice,
    currency: booking.currency,
  });

  if (isAlreadyVerified) {
    throw new AppError("This booking is already paid", 409);
  }

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

  const serviceTitle = (booking as any).service?.name || "Tour Experience";
  const customerEmail = (booking as any).customer?.email;

  const session = await activeStripeClient.createCheckoutSession({
    bookingId: booking.id,
    customerId: booking.customerId,
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

  // If rejected, notify customer synchronously; if verified, notification is handled durably via outbox
  if (input.decision === "REJECTED") {
    await notificationService.notifyPaymentDecision(payment.bookingId, "REJECTED");
  } else if (input.decision === "VERIFIED") {
    emitPaymentEvent("payment.verified", paymentId).catch((err) =>
      logger.error({ paymentId, err }, "Failed to emit payment.verified event")
    );
    emitBookingEvent("booking.status_changed", payment.bookingId, {
      paymentStatus: "PAID",
    }).catch((err) =>
      logger.error({ bookingId: payment.bookingId, err }, "Failed to emit booking.status_changed event")
    );
  }

  return mapPayment(updated);
};

export const recordPayment = async (
  actor: { id: string; role?: string } | string,
  paymentId: string,
  input: RecordPaymentInput,
) => {
  const actorId = typeof actor === "string" ? actor : actor.id;
  const actorRole = typeof actor === "string" ? undefined : actor.role;

  const payment = await getPaymentOr404(paymentId);

  // Authorization check for Staff:
  // Staff can only record offline payments for bookings they are authorized to manage (created by them or assigned to them)
  if (actorRole === "staff") {
    const booking = payment.booking as any;
    const isCreator = booking?.createdById === actorId;
    const isAssigned = booking?.assignedStaffId === actorId;

    if (!isCreator && !isAssigned) {
      throw new AppError("You are not authorized to record payments for this booking", 403);
    }
  }

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
      adminId: actorId,
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

  // Payment confirmation email is enqueued durably via transactional outbox inside transitionPayment

  return mapPayment(updated);
};

// ── CUSTOMER SECURE PAYMENT LINK WORKFLOW ────────────────────────────────────

/**
 * Generates or retrieves an active secure customer payment link for an agent booking.
 */
export const generateAgentPaymentLink = async (
  agentId: string,
  bookingId: string,
  expiresInDays = 7,
) => {
  const booking = await paymentRepository.findBookingForPayment(bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  // Security check: Must belong to requesting agent
  if (booking.agentId !== agentId) {
    throw new AppError("You can only generate payment links for your own bookings", 403);
  }

  if (booking.requiresApproval || booking.status === "AWAITING_APPROVAL" as any) {
    throw new AppError("Cannot create a payment link while custom price is awaiting admin approval", 409);
  }

  if (booking.status === "CANCELLED" || booking.status === "FAILED") {
    throw new AppError("Cannot create a payment link for a cancelled booking", 409);
  }

  // Calculate previously paid amount and remaining balance
  const totalAmount = Number(booking.finalPrice);
  const previouslyPaid = ((booking as any).payments || [])
    .filter((p: any) => p.status === "VERIFIED")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  const remainingBalance = Math.max(0, totalAmount - previouslyPaid);

  if (remainingBalance <= 0 || booking.paymentStatus === "PAID") {
    throw new AppError("This booking is already paid in full", 409);
  }

  // Generate a cryptographically secure token
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 7));

  const paymentLink = await paymentRepository.createOrUpdatePaymentLink({
    bookingId,
    tokenHash,
    expiresAt,
    createdById: agentId,
    actorRole: "agent",
  });

  const frontendBaseUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  const paymentUrl = `${frontendBaseUrl}/pay/${rawToken}`;

  return {
    paymentLinkId: paymentLink.id,
    bookingId: paymentLink.bookingId,
    paymentUrl,
    rawToken,
    expiresAt: paymentLink.expiresAt,
    status: paymentLink.status,
    totalAmount,
    previouslyPaid,
    remainingBalance,
  } as {
    paymentLinkId: string;
    bookingId: string;
    paymentUrl: string;
    rawToken: string;
    expiresAt: Date;
    status: any;
    totalAmount?: number;
    previouslyPaid?: number;
    remainingBalance?: number;
  };
};

/**
 * Generates or retrieves an active secure customer payment link for a staff-managed booking.
 * Enforces authorization: Admin or authorized Staff (who passed route-level bookings.create permission),
 * plus creator/assigned operational staff. Rejects non-staff roles (customer/agent).
 */
export const generateStaffPaymentLink = async (
  staffUser: { id: string; role: string },
  bookingId: string,
  expiresInDays = 7,
) => {
  const booking = await paymentRepository.findBookingForPayment(bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  // Authorization check: Admin, authorized Staff, creator, or assigned staff
  const normalizedRole = String(staffUser.role || "").toLowerCase();
  const isAdmin = normalizedRole === "admin";
  const isStaff = normalizedRole === "staff";
  const isCreator = (booking as any).createdById === staffUser.id;
  const isAssigned = (booking as any).assignedStaffId === staffUser.id;

  if (!isAdmin && !isStaff && !isCreator && !isAssigned) {
    throw new AppError("You are not authorized to generate a payment link for this booking", 403);
  }

  if (booking.status === "CANCELLED" || booking.status === "FAILED") {
    throw new AppError("Cannot create a payment link for a cancelled booking", 409);
  }

  if (!booking.finalPrice || Number(booking.finalPrice) <= 0 || !booking.currency) {
    throw new AppError("Booking has invalid pricing or currency", 400);
  }

  // Calculate previously paid amount and remaining balance
  const totalAmount = Number(booking.finalPrice);
  const previouslyPaid = ((booking as any).payments || [])
    .filter((p: any) => p.status === "VERIFIED")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  const remainingBalance = Math.max(0, totalAmount - previouslyPaid);

  if (remainingBalance <= 0 || booking.paymentStatus === "PAID") {
    throw new AppError("This booking is already paid in full", 409);
  }

  if (!PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new AppError(`Booking status ${booking.status} is not eligible for payment`, 409);
  }

  // Generate a cryptographically secure token
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 7));

  const paymentLink = await paymentRepository.createOrUpdatePaymentLink({
    bookingId,
    tokenHash,
    expiresAt,
    createdById: staffUser.id,
    actorRole: staffUser.role || "staff",
  });

  const frontendBaseUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  const paymentUrl = `${frontendBaseUrl}/pay/${rawToken}`;

  return {
    paymentLinkId: paymentLink.id,
    bookingId: paymentLink.bookingId,
    paymentUrl,
    rawToken,
    expiresAt: paymentLink.expiresAt,
    status: paymentLink.status,
    totalAmount,
    previouslyPaid,
    remainingBalance,
  } as {
    paymentLinkId: string;
    bookingId: string;
    paymentUrl: string;
    rawToken: string;
    expiresAt: Date;
    status: any;
    totalAmount?: number;
    previouslyPaid?: number;
    remainingBalance?: number;
  };
};

/**
 * Retrieves public booking details for a customer payment link token.
 * Masks customer sensitive data and omits internal agent notes.
 */
export const getPublicPaymentLinkDetails = async (rawToken: string) => {
  const tokenHash = hashToken(rawToken);
  const link = await paymentRepository.findPaymentLinkByTokenHash(tokenHash);

  if (!link) {
    throw new AppError("Payment link not found or invalid", 404);
  }

  const isExpired = new Date() > new Date(link.expiresAt);
  const isAlreadyPaid = link.booking.paymentStatus === "PAID";

  let effectiveStatus = link.status;
  if (isExpired && link.status === "ACTIVE") {
    effectiveStatus = "EXPIRED";
  } else if (isAlreadyPaid) {
    effectiveStatus = "COMPLETED";
  }

  const totalAmount = Number(link.booking.finalPrice);
  const paidAmount = (link.booking.payments || [])
    .filter((p: any) => p.status === "VERIFIED")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  const remainingBalance = Math.max(0, totalAmount - paidAmount);
  const isPayable =
    effectiveStatus === "ACTIVE" &&
    !isExpired &&
    remainingBalance > 0 &&
    (link.booking.status === "PENDING" || link.booking.status === "CONFIRMED");

  // Mask customer email (e.g., j***e@example.com)
  const rawEmail = link.booking.customer.email || "";
  const [userPart, domainPart] = rawEmail.split("@");
  let customerEmailMasked = "";
  if (domainPart) {
    if (userPart.length <= 2) {
      customerEmailMasked = `${userPart[0] || "*"}***@${domainPart}`;
    } else {
      customerEmailMasked = `${userPart[0]}***${userPart[userPart.length - 1]}@${domainPart}`;
    }
  }

  const stripeAvailable = Boolean(process.env.STRIPE_SECRET_KEY);
  const paypalAvailable = defaultPayPalClient.isAvailable();

  const supportedPaymentMethods = [];
  if (stripeAvailable) supportedPaymentMethods.push("STRIPE");
  if (paypalAvailable) supportedPaymentMethods.push("PAYPAL");

  return {
    bookingId: link.bookingId,
    tourTitle: link.booking.service.name,
    tourDescription: link.booking.service.description,
    travelDate: link.booking.availability?.date || null,
    customerName: link.booking.customer.name,
    customerEmailMasked,
    currency: link.booking.currency,
    totalAmount,
    paidAmount,
    remainingBalance,
    paymentStatus: link.booking.paymentStatus,
    bookingStatus: link.booking.status,
    linkStatus: effectiveStatus,
    expiresAt: link.expiresAt,
    isPayable,
    supportedPaymentMethods,
    stripeAvailable,
    paypalAvailable,
  };
};

/**
 * Creates a Stripe Checkout Session from a public customer payment link
 */
export const createPublicStripeCheckoutSession = async (
  rawToken: string,
  params?: { successUrl?: string; cancelUrl?: string },
) => {
  const tokenHash = hashToken(rawToken);
  const link = await paymentRepository.findPaymentLinkByTokenHash(tokenHash);

  if (!link) {
    throw new AppError("Invalid or expired payment link", 404);
  }

  if (link.status !== "ACTIVE" || new Date() > new Date(link.expiresAt)) {
    throw new AppError("This payment link is no longer active", 400);
  }

  if (link.booking.paymentStatus === "PAID") {
    throw new AppError("This booking is already paid in full", 409);
  }

  const totalAmount = Number(link.booking.finalPrice);
  const paidAmount = (link.booking.payments || [])
    .filter((p: any) => p.status === "VERIFIED")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  const remainingBalance = Math.max(0, totalAmount - paidAmount);
  if (remainingBalance <= 0) {
    throw new AppError("No remaining balance to pay for this booking", 409);
  }

  const frontendBase = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  const successUrl =
    params?.successUrl || `${frontendBase}/pay/${rawToken}?status=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    params?.cancelUrl || `${frontendBase}/pay/${rawToken}?status=cancelled`;

  const stripeClient = activeStripeClient;
  const session = await stripeClient.createCheckoutSession({
    bookingId: link.bookingId,
    customerId: link.booking.customerId,
    amountMinor: Math.round(remainingBalance * 100),
    currency: link.booking.currency.toLowerCase(),
    customerEmail: link.booking.customer.email,
    serviceTitle: link.booking.service.name,
    successUrl,
    cancelUrl,
  });

  // Record or update initiated payment
  const { payment } = await paymentRepository.createOrGetStripePayment({
    bookingId: link.bookingId,
    customerId: link.booking.customerId,
    amount: remainingBalance,
    currency: link.booking.currency,
  });

  await paymentRepository.updatePaymentStripeSession(payment.id, session.id);

  return {
    sessionId: session.id,
    sessionUrl: session.url,
    paymentId: payment.id,
    amount: remainingBalance,
    currency: link.booking.currency,
    status: payment.status,
  };
};

/**
 * Creates a PayPal Order from a public customer payment link
 */
export const createPublicPayPalOrder = async (
  rawToken: string,
  params?: { returnUrl?: string; cancelUrl?: string },
) => {
  if (!defaultPayPalClient.isAvailable()) {
    throw new AppError("PayPal is not currently configured on this platform", 503);
  }

  const tokenHash = hashToken(rawToken);
  const link = await paymentRepository.findPaymentLinkByTokenHash(tokenHash);

  if (!link) {
    throw new AppError("Invalid or expired payment link", 404);
  }

  if (link.status !== "ACTIVE" || new Date() > new Date(link.expiresAt)) {
    throw new AppError("This payment link is no longer active", 400);
  }

  if (link.booking.paymentStatus === "PAID") {
    throw new AppError("This booking is already paid in full", 409);
  }

  const totalAmount = Number(link.booking.finalPrice);
  const paidAmount = (link.booking.payments || [])
    .filter((p: any) => p.status === "VERIFIED")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  const remainingBalance = Math.max(0, totalAmount - paidAmount);
  if (remainingBalance <= 0) {
    throw new AppError("No remaining balance to pay for this booking", 409);
  }

  const frontendBase = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  const returnUrl = params?.returnUrl || `${frontendBase}/pay/${rawToken}?status=paypal-success`;
  const cancelUrl = params?.cancelUrl || `${frontendBase}/pay/${rawToken}?status=paypal-cancel`;

  const order = await defaultPayPalClient.createOrder({
    bookingId: link.bookingId,
    amount: remainingBalance,
    currency: link.booking.currency,
    description: `Booking for ${link.booking.service.name}`,
    returnUrl,
    cancelUrl,
    customId: link.bookingId,
  });

  const approveLink = order.links.find((l) => l.rel === "approve")?.href;

  return {
    orderId: order.id,
    status: order.status,
    approveUrl: approveLink || null,
    amount: remainingBalance,
    currency: link.booking.currency,
  };
};

/**
 * Captures an approved PayPal order from the customer payment link
 */
export const capturePublicPayPalOrder = async (
  rawToken: string,
  paypalOrderId: string,
) => {
  if (!defaultPayPalClient.isAvailable()) {
    throw new AppError("PayPal is not configured", 503);
  }

  const tokenHash = hashToken(rawToken);
  const link = await paymentRepository.findPaymentLinkByTokenHash(tokenHash);

  if (!link) {
    throw new AppError("Invalid payment link", 404);
  }

  const captureResponse = await defaultPayPalClient.captureOrder(paypalOrderId);

  if (captureResponse.status !== "COMPLETED") {
    throw new AppError(`PayPal payment could not be completed: Status ${captureResponse.status}`, 400);
  }

  const captureObj = captureResponse.purchase_units?.[0]?.payments?.captures?.[0];
  const capturedAmount = captureObj ? Number(captureObj.amount.value) : 0;
  const currency = captureObj?.amount.currency_code || link.booking.currency;

  const result = await paymentRepository.recordVerifiedPayPalPayment({
    bookingId: link.bookingId,
    customerId: link.booking.customerId,
    amount: capturedAmount > 0 ? capturedAmount : Number(link.booking.finalPrice),
    currency,
    paypalOrderId,
    paypalCaptureId: captureObj?.id,
    rawPayload: captureResponse,
  });

  return {
    success: true,
    paymentId: result.payment.id,
    amount: Number(result.payment.amount),
    currency: result.payment.currency,
    status: result.payment.status,
    isDuplicate: result.isDuplicate,
  };
};

/**
 * Handles incoming PayPal Webhooks with verification and idempotency
 */
export const handlePayPalWebhook = async (
  headers: Record<string, string | string[] | undefined>,
  eventBody: any,
) => {
  const authAlgo = (headers["paypal-auth-algo"] as string) || "";
  const certUrl = (headers["paypal-cert-url"] as string) || "";
  const transmissionId = (headers["paypal-transmission-id"] as string) || "";
  const transmissionSig = (headers["paypal-transmission-sig"] as string) || "";
  const transmissionTime = (headers["paypal-transmission-time"] as string) || "";

  const isValid = await defaultPayPalClient.verifyWebhookSignature({
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSig,
    transmissionTime,
    webhookEvent: eventBody,
  });

  if (!isValid && process.env.NODE_ENV === "production") {
    throw new AppError("Invalid PayPal webhook signature", 400);
  }

  const eventType = eventBody?.event_type;
  logger.info(`[PayPal Webhook] Received ${eventType} event ID ${eventBody?.id}`);

  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const resource = eventBody?.resource;
    const captureId = resource?.id;
    const amountVal = Number(resource?.amount?.value);
    const currency = resource?.amount?.currency_code;
    const customId = resource?.custom_id;

    if (customId && amountVal > 0) {
      const booking = await paymentRepository.findBookingForPayment(customId);
      if (booking) {
        await paymentRepository.recordVerifiedPayPalPayment({
          bookingId: booking.id,
          customerId: booking.customerId,
          amount: amountVal,
          currency: currency || booking.currency,
          paypalOrderId: captureId || eventBody.id,
          paypalCaptureId: captureId,
          rawPayload: eventBody,
        });
      }
    }
  }

  return { received: true };
};

// ==========================================
// OMISE PAYMENT LIFECYCLE (PHASE 2)
// ==========================================

export interface CreateOmiseChargeInput {
  bookingId: string;
  token: string;
  returnUrl?: string;
}

export interface OmiseChargeResult {
  paymentId: string;
  bookingId: string;
  amount: number;
  currency: string;
  status: string;
  requiresAction: boolean;
  authorizeUri: string | null;
  omiseChargeId: string;
}

/**
 * Creates an Omise card charge for a customer booking.
 * Calculates remaining balance authoritatively, enforces THB currency,
 * converts to satangs, and supports both immediate non-3DS and pending 3DS flows.
 */
export const createCustomerOmiseCharge = async (
  customerId: string,
  input: CreateOmiseChargeInput,
): Promise<OmiseChargeResult> => {
  const isEnabled = await isOmiseGatewayEnabled();
  if (!isEnabled) {
    throw new AppError("Omise card payments are currently disabled by administrator", 400);
  }

  if (!activeOmiseClient.isConfigured()) {
    throw new AppError("Omise payment gateway is not configured on this server", 503);
  }

  if (!input.token || typeof input.token !== "string" || !input.token.startsWith("tokn_")) {
    throw new AppError("A valid Omise single-use card token is required", 400);
  }

  const booking = await paymentRepository.findBookingForPayment(input.bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  if (booking.customerId !== customerId) {
    throw new AppError("You do not have access to pay for this booking", 403);
  }

  if (!PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new AppError(`Booking in status ${booking.status} is not eligible for payment`, 409);
  }

  if (booking.requiresApproval) {
    throw new AppError("This booking requires price approval before payment can be accepted", 409);
  }

  if (booking.paymentStatus === "PAID") {
    throw new AppError("This booking is already paid in full", 409);
  }

  // Omise card payments are strictly THB
  if (booking.currency.toUpperCase() !== "THB") {
    throw new AppError(
      `Omise card payments only support THB currency. Current booking currency is ${booking.currency}`,
      400,
    );
  }

  const totalAmount = Number(booking.finalPrice);
  const previouslyPaid = ((booking as any).payments || [])
    .filter((p: any) => p.status === "VERIFIED")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  const remainingBalance = Math.max(0, totalAmount - previouslyPaid);
  if (remainingBalance <= 0) {
    throw new AppError("No remaining balance to pay for this booking", 409);
  }

  // Atomically create or reuse an INITIATED payment record
  const { payment, isAlreadyVerified } = await paymentRepository.createOrGetOmisePayment({
    bookingId: booking.id,
    customerId,
    amount: remainingBalance,
    currency: "THB",
  });

  if (isAlreadyVerified) {
    return {
      paymentId: payment.id,
      bookingId: booking.id,
      amount: remainingBalance,
      currency: "THB",
      status: "VERIFIED",
      requiresAction: false,
      authorizeUri: null,
      omiseChargeId: payment.omiseChargeId || "",
    };
  }

  // Determine return_uri for 3DS authentication
  const frontendBase = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  const defaultReturnUri = `${frontendBase}/checkout/omise-return?paymentId=${payment.id}&bookingId=${booking.id}`;
  const returnUri = input.returnUrl || defaultReturnUri;

  let charge: OmiseChargeResponse;
  try {
    charge = await activeOmiseClient.createCardCharge({
      amount: remainingBalance,
      token: input.token,
      returnUri,
      description: `Booking #${booking.id} - ${booking.service?.name || "Tour"}`,
      metadata: {
        bookingId: booking.id,
        paymentId: payment.id,
        customerId,
      },
    });
  } catch (err: any) {
    await paymentRepository.updateOmisePaymentStatus({
      paymentId: payment.id,
      bookingId: booking.id,
      status: "FAILED",
      failureReason: err?.message || "Omise charge creation failed",
    });
    throw new AppError(err?.message || "Failed to create Omise charge", err?.status || 400);
  }

  // Scenario A: Non-3DS Frictionless Immediate Success
  if (charge.status === "successful" && charge.authorized) {
    await paymentRepository.verifyOmisePaymentAtomically({
      paymentId: payment.id,
      bookingId: booking.id,
      amount: remainingBalance,
      currency: "THB",
      omiseChargeId: charge.id,
      omiseTransactionId: charge.transaction,
    });

    emitPaymentEvent("payment.verified", payment.id).catch((err) =>
      logger.error({ paymentId: payment.id, err }, "Failed to emit payment.verified event"),
    );
    emitBookingEvent("booking.status_changed", booking.id, { paymentStatus: "PAID" }).catch((err) =>
      logger.error({ bookingId: booking.id, err }, "Failed to emit booking.status_changed event"),
    );

    return {
      paymentId: payment.id,
      bookingId: booking.id,
      amount: remainingBalance,
      currency: "THB",
      status: "VERIFIED",
      requiresAction: false,
      authorizeUri: null,
      omiseChargeId: charge.id,
    };
  }

  // Scenario B: 3-D Secure Pending Action Required
  if (charge.status === "pending" && charge.authorize_uri) {
    await paymentRepository.updatePaymentOmiseCharge(
      payment.id,
      charge.id,
      "REQUIRES_ACTION",
    );

    return {
      paymentId: payment.id,
      bookingId: booking.id,
      amount: remainingBalance,
      currency: "THB",
      status: "REQUIRES_ACTION",
      requiresAction: true,
      authorizeUri: charge.authorize_uri,
      omiseChargeId: charge.id,
    };
  }

  // Scenario C: Immediate Failure / Declined
  const failureMsg = charge.failure_message || "Card charge was not approved";
  await paymentRepository.updatePaymentOmiseCharge(
    payment.id,
    charge.id,
    "FAILED",
    failureMsg,
  );

  throw new AppError(`Omise payment rejected: ${failureMsg}`, 400);
};

/**
 * Creates an Omise card charge from a public payment link token.
 */
export const createPublicOmiseCharge = async (
  rawToken: string,
  input: { token: string; returnUrl?: string },
): Promise<OmiseChargeResult> => {
  const isEnabled = await isOmiseGatewayEnabled();
  if (!isEnabled) {
    throw new AppError("Omise card payments are currently disabled by administrator", 400);
  }

  if (!activeOmiseClient.isConfigured()) {
    throw new AppError("Omise payment gateway is not configured", 503);
  }

  const tokenHash = hashToken(rawToken);
  const link = await paymentRepository.findPaymentLinkByTokenHash(tokenHash);

  if (!link) {
    throw new AppError("Invalid or expired payment link", 404);
  }

  if (link.status !== "ACTIVE" || new Date() > new Date(link.expiresAt)) {
    throw new AppError("This payment link is no longer active", 400);
  }

  if (link.booking.paymentStatus === "PAID") {
    throw new AppError("This booking is already paid in full", 409);
  }

  if (link.booking.currency.toUpperCase() !== "THB") {
    throw new AppError(
      `Omise card payments only support THB currency. Current booking currency is ${link.booking.currency}`,
      400,
    );
  }

  const totalAmount = Number(link.booking.finalPrice);
  const paidAmount = (link.booking.payments || [])
    .filter((p: any) => p.status === "VERIFIED")
    .reduce((sum: number, p: any) => sum + Number(p.amount), 0);

  const remainingBalance = Math.max(0, totalAmount - paidAmount);
  if (remainingBalance <= 0) {
    throw new AppError("No remaining balance to pay for this booking", 409);
  }

  const { payment, isAlreadyVerified } = await paymentRepository.createOrGetOmisePayment({
    bookingId: link.bookingId,
    customerId: link.booking.customerId,
    amount: remainingBalance,
    currency: "THB",
  });

  if (isAlreadyVerified) {
    return {
      paymentId: payment.id,
      bookingId: link.bookingId,
      amount: remainingBalance,
      currency: "THB",
      status: "VERIFIED",
      requiresAction: false,
      authorizeUri: null,
      omiseChargeId: payment.omiseChargeId || "",
    };
  }

  const frontendBase = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  const defaultReturnUri = `${frontendBase}/pay/${rawToken}?status=omise-return&paymentId=${payment.id}`;
  const returnUri = input.returnUrl || defaultReturnUri;

  let charge: OmiseChargeResponse;
  try {
    charge = await activeOmiseClient.createCardCharge({
      amount: remainingBalance,
      token: input.token,
      returnUri,
      description: `Public Booking #${link.bookingId}`,
      metadata: {
        bookingId: link.bookingId,
        paymentId: payment.id,
        customerId: link.booking.customerId,
        paymentToken: rawToken,
      },
    });
  } catch (err: any) {
    await paymentRepository.updateOmisePaymentStatus({
      paymentId: payment.id,
      bookingId: link.bookingId,
      status: "FAILED",
      failureReason: err?.message || "Omise charge creation failed",
    });
    throw new AppError(err?.message || "Failed to create Omise charge", err?.status || 400);
  }

  if (charge.status === "successful" && charge.authorized) {
    await paymentRepository.verifyOmisePaymentAtomically({
      paymentId: payment.id,
      bookingId: link.bookingId,
      amount: remainingBalance,
      currency: "THB",
      omiseChargeId: charge.id,
      omiseTransactionId: charge.transaction,
    });

    return {
      paymentId: payment.id,
      bookingId: link.bookingId,
      amount: remainingBalance,
      currency: "THB",
      status: "VERIFIED",
      requiresAction: false,
      authorizeUri: null,
      omiseChargeId: charge.id,
    };
  }

  if (charge.status === "pending" && charge.authorize_uri) {
    await paymentRepository.updatePaymentOmiseCharge(
      payment.id,
      charge.id,
      "REQUIRES_ACTION",
    );

    return {
      paymentId: payment.id,
      bookingId: link.bookingId,
      amount: remainingBalance,
      currency: "THB",
      status: "REQUIRES_ACTION",
      requiresAction: true,
      authorizeUri: charge.authorize_uri,
      omiseChargeId: charge.id,
    };
  }

  const failureMsg = charge.failure_message || "Card charge was not approved";
  await paymentRepository.updatePaymentOmiseCharge(
    payment.id,
    charge.id,
    "FAILED",
    failureMsg,
  );

  throw new AppError(`Omise payment rejected: ${failureMsg}`, 400);
};

/**
 * Verifies Omise charge status upon customer return from 3DS redirect.
 * Retrieves live status directly from Omise API and settles atomically.
 */
export const verifyOmiseChargeReturn = async (
  paymentId: string,
  requester?: { id: string; role: string },
): Promise<{
  paymentId: string;
  bookingId: string;
  status: string;
  verified: boolean;
  message?: string;
}> => {
  const payment = await getPaymentOr404(paymentId);

  if (requester && requester.role === "customer" && payment.customerId !== requester.id) {
    throw new AppError("Payment not found", 404);
  }

  if (payment.method !== "OMISE") {
    throw new AppError("Only Omise payments can be verified with this endpoint", 400);
  }

  // If already verified locally, return safe success
  if (payment.status === "VERIFIED") {
    return {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      status: "VERIFIED",
      verified: true,
      message: "Payment is already verified",
    };
  }

  if (!payment.omiseChargeId) {
    throw new AppError("No Omise charge ID recorded on this payment attempt", 400);
  }

  // Authoritatively query Omise API
  let liveCharge: OmiseChargeResponse;
  try {
    liveCharge = await activeOmiseClient.retrieveCharge(payment.omiseChargeId);
  } catch (err: any) {
    logger.warn({ err: err.message, paymentId }, "Failed to retrieve Omise charge during return verification");
    throw new AppError("Could not retrieve charge status from Omise", 502);
  }

  // Live charge is successful & authorized
  if (liveCharge.status === "successful" && liveCharge.authorized) {
    const chargeCurrency = (liveCharge.currency || "THB").toUpperCase();
    const chargeAmount = liveCharge.amount / 100;

    const result = await paymentRepository.verifyOmisePaymentAtomically({
      paymentId: payment.id,
      bookingId: payment.bookingId,
      amount: chargeAmount,
      currency: chargeCurrency,
      omiseChargeId: liveCharge.id,
      omiseTransactionId: liveCharge.transaction,
    });

    emitPaymentEvent("payment.verified", payment.id).catch((err) =>
      logger.error({ paymentId: payment.id, err }, "Failed to emit payment.verified event"),
    );
    emitBookingEvent("booking.status_changed", payment.bookingId, { paymentStatus: "PAID" }).catch((err) =>
      logger.error({ bookingId: payment.bookingId, err }, "Failed to emit booking.status_changed event"),
    );

    return {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      status: "VERIFIED",
      verified: true,
      message: result.isDuplicateSuccess ? "Payment was already verified" : "Payment verified successfully",
    };
  }

  // Live charge is still pending
  if (liveCharge.status === "pending") {
    return {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      status: "REQUIRES_ACTION",
      verified: false,
      message: "Payment is still pending 3-D Secure authorization",
    };
  }

  // Live charge failed
  const failureReason = liveCharge.failure_message || "Charge was not successful";
  await paymentRepository.updateOmisePaymentStatus({
    paymentId: payment.id,
    bookingId: payment.bookingId,
    status: "FAILED",
    failureReason,
  });

  return {
    paymentId: payment.id,
    bookingId: payment.bookingId,
    status: "FAILED",
    verified: false,
    message: failureReason,
  };
};

/**
 * Processes incoming Omise webhooks.
 * Validates HMAC signature, prevents replay, deduplicates events, and reconciles state.
 */
export const handleOmiseWebhook = async (
  rawBody: Buffer | string,
  signatureHeader: string,
  timestampHeader?: string,
  webhookSecretOverride?: string,
): Promise<WebhookProcessingResult> => {
  const webhookSecret =
    webhookSecretOverride ||
    activeOmiseClient.getWebhookSecret() ||
    process.env.OMISE_WEBHOOK_SECRET ||
    "";
  const isValid = activeOmiseClient.verifyWebhookSignature(
    rawBody,
    signatureHeader,
    timestampHeader,
    webhookSecret,
  );
  if (!isValid) {
    logger.warn("Invalid Omise webhook signature");
    throw new AppError("Invalid Omise webhook signature", 400);
  }

  const payload: any = JSON.parse(
    Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody,
  );

  const eventId = payload.id;
  const eventKey = payload.key || payload.type;
  const eventData = payload.data || {};

  if (!eventId || !eventKey) {
    throw new AppError("Invalid Omise webhook payload structure", 400);
  }

  logger.info({ eventId, eventKey }, "Received Omise webhook");

  // Charge complete event
  if (eventKey === "charge.complete") {
    const chargeId = eventData.id;
    if (!chargeId) {
      return { received: true, eventId, type: eventKey, status: "IGNORED", message: "Missing charge ID" };
    }

    // Authoritatively retrieve charge to avoid forged payload data
    let charge: OmiseChargeResponse;
    try {
      charge = await activeOmiseClient.retrieveCharge(chargeId);
    } catch (err: any) {
      logger.error({ err: err.message, chargeId }, "Failed to fetch charge for Omise webhook");
      throw new AppError("Failed to fetch authoritative charge from Omise", 502);
    }

    const targetPayment = await paymentRepository.findPaymentByOmiseChargeId(chargeId);
    if (!targetPayment) {
      logger.warn({ chargeId }, "No local payment found matching Omise charge");
      return { received: true, eventId, type: eventKey, status: "IGNORED", message: "Payment not found" };
    }

    if (charge.status === "successful" && charge.authorized) {
      const chargeAmount = charge.amount / 100;
      const chargeCurrency = (charge.currency || "THB").toUpperCase();

      await paymentRepository.verifyOmisePaymentAtomically({
        paymentId: targetPayment.id,
        bookingId: targetPayment.bookingId,
        amount: chargeAmount,
        currency: chargeCurrency,
        omiseChargeId: charge.id,
        omiseTransactionId: charge.transaction,
      });

      emitPaymentEvent("payment.verified", targetPayment.id).catch((err) =>
        logger.error({ paymentId: targetPayment.id, err }, "Failed to emit payment.verified event"),
      );
      emitBookingEvent("booking.status_changed", targetPayment.bookingId, { paymentStatus: "PAID" }).catch((err) =>
        logger.error({ bookingId: targetPayment.bookingId, err }, "Failed to emit booking.status_changed event"),
      );

      return {
        received: true,
        eventId,
        type: eventKey,
        status: "PROCESSED",
        bookingId: targetPayment.bookingId,
        paymentId: targetPayment.id,
      };
    } else if (charge.status === "failed") {
      await paymentRepository.updateOmisePaymentStatus({
        paymentId: targetPayment.id,
        bookingId: targetPayment.bookingId,
        status: "FAILED",
        failureReason: charge.failure_message || "Omise charge failed",
      });

      return {
        received: true,
        eventId,
        type: eventKey,
        status: "PROCESSED",
        bookingId: targetPayment.bookingId,
        paymentId: targetPayment.id,
      };
    }
  }

  // Refund created / charge refunded event
  if (eventKey === "refund.create" || eventKey === "charge.refunded") {
    const refundObj = eventData;
    const chargeId = refundObj.charge || eventData.id;
    if (chargeId) {
      const targetPayment = await paymentRepository.findPaymentByOmiseChargeId(chargeId);
      if (targetPayment) {
        const refundAmount = refundObj.amount ? refundObj.amount / 100 : 0;
        const currency = (refundObj.currency || targetPayment.currency || "THB").toUpperCase();

        if (refundAmount > 0) {
          await prisma.$transaction(async (tx) => {
            await recordAffiliateCommissionReversal(tx, {
              bookingId: targetPayment.bookingId,
              paymentId: targetPayment.id,
              refundId: refundObj.id || eventId,
              refundAmount,
              currency,
              reason: refundObj.metadata?.reason || "Omise webhook refund",
            });
          });
        }

        return {
          received: true,
          eventId,
          type: eventKey,
          status: "PROCESSED",
          bookingId: targetPayment.bookingId,
          paymentId: targetPayment.id,
        };
      }
    }
  }

  return { received: true, eventId, type: eventKey, status: "IGNORED" };
};

/**
 * Creates an Omise refund for a verified payment.
 * Validates refundable amount against the actual successful charge,
 * prevents duplicate refunds, and creates affiliate reversal idempotently.
 */
export const refundOmisePayment = async (
  paymentId: string,
  input: { amount?: number; reason?: string },
  adminId: string,
): Promise<{
  refundId: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
}> => {
  const payment = await getPaymentOr404(paymentId);

  if (payment.method !== "OMISE") {
    throw new AppError("Only Omise payments can be refunded via this method", 400);
  }

  if (payment.status !== "VERIFIED") {
    throw new AppError(`Cannot refund a payment with status ${payment.status}`, 409);
  }

  if (!payment.omiseChargeId) {
    throw new AppError("Payment does not have an associated Omise charge ID", 400);
  }

  const paymentAmount = Number(payment.amount);
  const refundAmount = input.amount !== undefined ? input.amount : paymentAmount;

  if (refundAmount <= 0 || refundAmount > paymentAmount) {
    throw new AppError(
      `Invalid refund amount ${refundAmount}. Must be between 0.01 and ${paymentAmount}`,
      400,
    );
  }

  const omiseRefund = await activeOmiseClient.createRefund({
    chargeId: payment.omiseChargeId,
    amount: refundAmount,
    reason: input.reason || "Admin initiated refund",
  });

  const currency = (omiseRefund.currency || payment.currency || "THB").toUpperCase();
  const refundedAmountMajor = omiseRefund.amount / 100;

  // Atomically update payment and affiliate reversal
  await prisma.$transaction(async (tx) => {
    const isFullRefund = Math.abs(refundedAmountMajor - paymentAmount) < 0.01;
    const newStatus = isFullRefund ? "REFUNDED" : "PARTIALLY_REFUNDED";

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: newStatus,
        reviewNotes: input.reason || "Refunded via Omise",
      },
    });

    if (isFullRefund) {
      await tx.booking.update({
        where: { id: payment.bookingId },
        data: { paymentStatus: "UNPAID" },
      });
    }

    await recordAffiliateCommissionReversal(tx, {
      bookingId: payment.bookingId,
      paymentId: payment.id,
      refundId: omiseRefund.id,
      refundAmount: refundedAmountMajor,
      currency,
      reason: input.reason || "Admin initiated Omise refund",
      actorId: adminId,
    });

    await tx.bookingHistory.create({
      data: {
        bookingId: payment.bookingId,
        actorId: adminId,
        actorRole: "admin",
        action: isFullRefund ? "PAYMENT_REFUNDED" : "PAYMENT_PARTIALLY_REFUNDED",
        changes: {
          paymentId: payment.id,
          omiseRefundId: omiseRefund.id,
          amount: refundedAmountMajor,
          currency,
          reason: input.reason || null,
        },
      },
    });
  });

  emitPaymentEvent("payment.refunded", payment.id).catch((err) =>
    logger.error({ paymentId: payment.id, err }, "Failed to emit payment.refunded event"),
  );

  return {
    refundId: omiseRefund.id,
    paymentId: payment.id,
    amount: refundedAmountMajor,
    currency,
    status: "SUCCEEDED",
  };
};



