import { prisma } from "../../lib/prisma.js";
import { dashboardEventHub } from "./eventHub.js";
import logger from "../../shared/logger/logger.js";
import type { DashboardEventType, DashboardEventMetadata } from "./eventTypes.js";

/**
 * Publishes a real-time dashboard event for a booking.
 * Fetches minimal safe ownership metadata from the database (only if not provided)
 * and emits via dashboardEventHub.
 */
export const emitBookingEvent = async (
  type: DashboardEventType,
  bookingId: string,
  extraMetadata: DashboardEventMetadata = {}
): Promise<void> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        customerId: true,
        agentId: true,
        assignedStaffId: true,
        createdById: true,
        serviceId: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        currency: true,
        finalPrice: true,
        requiresApproval: true,
        affiliateAttribution: {
          select: { affiliateId: true },
        },
      },
    });

    if (!booking) {
      logger.warn({ bookingId, type }, "Could not emit booking event: booking not found");
      return;
    }

    const metadata: DashboardEventMetadata = {
      customerId: booking.customerId,
      agentId: booking.agentId,
      assignedStaffId: booking.assignedStaffId,
      createdById: booking.createdById,
      affiliateId: booking.affiliateAttribution?.affiliateId ?? null,
      serviceId: booking.serviceId,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      fulfillmentStatus: booking.fulfillmentStatus,
      currency: booking.currency,
      amount: Number(booking.finalPrice),
      requiresApproval: booking.requiresApproval,
      ...extraMetadata,
    };

    dashboardEventHub.publishEvent(type, booking.id, metadata);
    logger.debug({ bookingId: booking.id, type, metadata }, "Dispatched dashboard SSE event");
  } catch (err: any) {
    logger.error({ bookingId, type, err: err?.message || err }, "Failed to emit booking event");
  }
};

/**
 * Publishes a real-time dashboard event for a payment.
 */
export const emitPaymentEvent = async (
  type: "payment.verified" | "payment.refunded",
  paymentId: string,
  extraMetadata: DashboardEventMetadata = {}
): Promise<void> => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        bookingId: true,
        amount: true,
        currency: true,
        status: true,
        booking: {
          select: {
            customerId: true,
            agentId: true,
            assignedStaffId: true,
            createdById: true,
            affiliateAttribution: {
              select: { affiliateId: true },
            },
          },
        },
      },
    });

    if (!payment) {
      logger.warn({ paymentId, type }, "Could not emit payment event: payment not found");
      return;
    }

    const metadata: DashboardEventMetadata = {
      customerId: payment.booking.customerId,
      agentId: payment.booking.agentId,
      assignedStaffId: payment.booking.assignedStaffId,
      createdById: payment.booking.createdById,
      affiliateId: payment.booking.affiliateAttribution?.affiliateId ?? null,
      bookingId: payment.bookingId,
      amount: Number(payment.amount),
      currency: payment.currency,
      paymentStatus: payment.status,
      ...extraMetadata,
    };

    dashboardEventHub.publishEvent(type, payment.id, metadata);
    logger.debug({ paymentId: payment.id, type, metadata }, "Dispatched dashboard SSE payment event");
  } catch (err: any) {
    logger.error({ paymentId, type, err: err?.message || err }, "Failed to emit payment event");
  }
};
