import logger from "../../shared/logger/logger.js";
import { sendEmail } from "../../shared/utils/mailer.js";
import * as notificationRepository from "./notificationRepository.js";
import { NOTIFICATION_EVENTS } from "./notificationTypes.js";
import type {
  MessageContext,
  NotificationEventValue,
  UpdateNotificationSettingsInput,
} from "./notificationTypes.js";

const humanize = (value: string): string => value.replace(/_/g, " ").toLowerCase();

export const getSettings = async () => {
  const stored = await notificationRepository.listSettings();
  const byEvent = new Map(stored.map((setting) => [setting.event, setting]));

  return {
    settings: NOTIFICATION_EVENTS.map((event) => ({
      event,
      enabled: byEvent.get(event)?.enabled ?? true,
      updatedAt: byEvent.get(event)?.updatedAt ?? null,
    })),
  };
};

export const updateSettings = async (adminId: string, input: UpdateNotificationSettingsInput) => {
  await notificationRepository.upsertSettings(input.settings, adminId);
  return getSettings();
};

const notifyBookingParties = async (
  bookingId: string,
  event: NotificationEventValue,
  subject: string,
  compose: (context: MessageContext) => string,
): Promise<void> => {
  try {
    const setting = await notificationRepository.findSetting(event);
    if (setting && !setting.enabled) {
      return;
    }

    const booking = await notificationRepository.findBookingRecipients(bookingId);
    if (!booking) {
      return;
    }

    const recipients = [booking.customer, booking.agent].filter(
      (user): user is NonNullable<typeof user> => user !== null && user.status === "active",
    );

    for (const recipient of recipients) {
      try {
        await sendEmail({
          to: recipient.email,
          subject,
          text: compose({
            recipientName: recipient.name,
            serviceName: booking.service.name,
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            fulfillmentStatus: booking.fulfillmentStatus,
          }),
        });
      } catch (error) {
        logger.error({ err: error, bookingId, event }, "Failed to send booking notification");
      }
    }
  } catch (error) {
    logger.error({ err: error, bookingId, event }, "Failed to process booking notification");
  }
};

export const notifyBookingCreated = async (bookingId: string): Promise<void> =>
  notifyBookingParties(bookingId, "BOOKING_CONFIRMATION", "Your booking has been received", (c) => {
    const state =
      c.status === "AWAITING_APPROVAL"
        ? "is awaiting price approval"
        : c.status === "CONFIRMED"
          ? "is confirmed"
          : "has been received";
    return `Hello ${c.recipientName},\n\nYour booking for ${c.serviceName} ${state}.`;
  });

export const notifyBookingStatusChanged = async (bookingId: string): Promise<void> =>
  notifyBookingParties(bookingId, "BOOKING_STATUS_CHANGE", "Your booking status has changed", (c) =>
    `Hello ${c.recipientName},\n\nYour booking for ${c.serviceName} is now ${humanize(c.status)}.`,
  );

export const notifyPaymentDecision = async (
  bookingId: string,
  outcome: "CONFIRMED" | "REJECTED",
): Promise<void> =>
  notifyBookingParties(
    bookingId,
    "PAYMENT_CONFIRMATION",
    outcome === "CONFIRMED" ? "Your payment has been confirmed" : "Your payment could not be verified",
    (c) =>
      outcome === "CONFIRMED"
        ? `Hello ${c.recipientName},\n\nWe have confirmed the payment for your ${c.serviceName} booking.`
        : `Hello ${c.recipientName},\n\nWe could not verify the payment for your ${c.serviceName} booking. Please contact us or submit a new payment.`,
  );

export const notifyOperationalUpdate = async (bookingId: string): Promise<void> =>
  notifyBookingParties(bookingId, "OPERATIONAL_UPDATE", "An update on your booking", (c) =>
    `Hello ${c.recipientName},\n\nYour ${c.serviceName} booking is now ${humanize(c.fulfillmentStatus)}.`,
  );