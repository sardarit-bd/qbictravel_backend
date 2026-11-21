import logger from "../../shared/logger/logger.js";
import { sendEmail, type MailAttachment } from "../../shared/utils/mailer.js";
import * as notificationRepository from "./notificationRepository.js";
import { NOTIFICATION_EVENTS } from "./notificationTypes.js";
import type {
  CreateNotificationInput,
  MessageContext,
  NotificationEventValue,
  NotificationPreferencesInput,
  NotificationQueryFilters,
  PersistentNotificationType,
  UpdateNotificationSettingsInput,
} from "./notificationTypes.js";
import { getOrCreatePaymentReceipt } from "../invoice/invoiceService.js";
import { dashboardEventHub } from "../event/eventHub.js";

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

/**
 * Creates and persists an in-app notification record and broadcasts a minimal
 * notification.created event to the specific recipient via the existing SSE event hub.
 */
export const dispatchNotification = async (input: CreateNotificationInput) => {
  try {
    // Check recipient's in-app notification preference
    const prefs = await notificationRepository.getPreferences(input.recipientUserId);
    const category = input.entityType;

    if (category === "booking" && prefs.bookingInApp === false) return null;
    if (category === "payment" && prefs.paymentInApp === false) return null;
    if (category === "commission" && prefs.commissionInApp === false) return null;
    if (category === "assignment" && prefs.assignmentInApp === false) return null;

    const notification = await notificationRepository.createNotification(input);

    // Commit to DB first, then publish minimal SSE event (never raw sensitive metadata)
    dashboardEventHub.publishEvent("notification.created", notification.id, {
      recipientUserId: notification.recipientUserId,
      notificationId: notification.id,
      type: notification.type,
      entityType: notification.entityType,
      entityId: notification.entityId,
    });

    return notification;
  } catch (error) {
    logger.error({ err: error, input }, "Failed to create or publish persistent notification");
    return null;
  }
};

/**
 * Resolves recipients and dispatches role-based persistent notifications for booking lifecycle events.
 */
export const notifyBookingEvent = async (
  bookingId: string,
  type: PersistentNotificationType,
  details?: {
    customTitle?: string;
    customMessage?: string;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<void> => {
  try {
    const booking = await notificationRepository.findBookingRecipients(bookingId);
    if (!booking) return;

    const adminIds = await notificationRepository.findActiveAdminUserIds();
    const serviceName = booking.service.name;
    const ref = booking.id.slice(0, 8).toUpperCase();

    // 1. Resolve Admin Notifications
    for (const adminId of adminIds) {
      let title = `Booking Update: ${ref}`;
      let message = `Booking ${ref} for ${serviceName} has been updated.`;

      if (type === "booking.created") {
        title = `New Booking Created: ${ref}`;
        message = `A new booking has been submitted for ${serviceName}.`;
      } else if (type === "booking.approved") {
        title = `Booking Approved: ${ref}`;
        message = `Booking ${ref} has been approved.`;
      } else if (type === "booking.rejected") {
        title = `Booking Rejected: ${ref}`;
        message = `Booking ${ref} was rejected.`;
      } else if (type === "booking.completed") {
        title = `Tour Completed: ${ref}`;
        message = `Tour for booking ${ref} has been marked as completed.`;
      } else if (type === "booking.cancelled") {
        title = `Booking Cancelled: ${ref}`;
        message = `Booking ${ref} has been cancelled.`;
      }

      await dispatchNotification({
        recipientUserId: adminId,
        type,
        title: details?.customTitle || title,
        message: details?.customMessage || message,
        entityType: "booking",
        entityId: booking.id,
        actionUrl: `/dashboard/admin/bookings`,
        idempotencyKey: `notif_${adminId}_${booking.id}_${type}`,
        metadata: details?.extraMetadata,
      });
    }

    // 2. Resolve Agent Notifications
    if (booking.agentId && booking.agent && booking.agent.status === "active") {
      let agentTitle = `Booking Update: ${ref}`;
      let agentMessage = `Your booking ${ref} has been updated.`;
      let agentType = type;

      if (type === "booking.created") {
        agentType = "agent.booking_created";
        agentTitle = `Booking Confirmed: ${ref}`;
        agentMessage = `Your partner booking for ${serviceName} has been created.`;
      } else if (type === "booking.approved") {
        agentType = "agent.price_approved";
        agentTitle = `Special Price Approved: ${ref}`;
        agentMessage = `Your booking ${ref} has been approved by admin.`;
      } else if (type === "booking.rejected") {
        agentType = "agent.price_rejected";
        agentTitle = `Price Request Rejected: ${ref}`;
        agentMessage = `Your booking price request for ${ref} was not approved.`;
      }

      await dispatchNotification({
        recipientUserId: booking.agent.id,
        type: agentType,
        title: agentTitle,
        message: agentMessage,
        entityType: "booking",
        entityId: booking.id,
        actionUrl: `/dashboard/agent/bookings`,
        idempotencyKey: `notif_${booking.agent.id}_${booking.id}_${agentType}`,
        metadata: details?.extraMetadata,
      });
    }

    // 3. Resolve Customer Notifications (if not a guest)
    if (!booking.isGuest && booking.customerId && booking.customer && booking.customer.status === "active") {
      let custTitle = `Booking Update: ${ref}`;
      let custMessage = `Your booking for ${serviceName} status is now ${booking.status}.`;

      if (type === "booking.created") {
        custTitle = `Booking Confirmation: ${ref}`;
        custMessage = `Thank you! Your booking for ${serviceName} is confirmed.`;
      } else if (type === "booking.completed") {
        custTitle = `Tour Completed: ${ref}`;
        custMessage = `We hope you enjoyed your tour ${serviceName}!`;
      } else if (type === "booking.cancelled") {
        custTitle = `Booking Cancelled: ${ref}`;
        custMessage = `Your booking ${ref} has been cancelled.`;
      }

      await dispatchNotification({
        recipientUserId: booking.customer.id,
        type,
        title: custTitle,
        message: custMessage,
        entityType: "booking",
        entityId: booking.id,
        actionUrl: `/dashboard/bookings/${booking.id}`,
        idempotencyKey: `notif_${booking.customer.id}_${booking.id}_${type}`,
        metadata: details?.extraMetadata,
      });
    }

    // 4. Resolve Assigned Staff Notifications
    if (booking.assignedStaffId && booking.assignedStaff && booking.assignedStaff.status === "active") {
      await dispatchNotification({
        recipientUserId: booking.assignedStaff.id,
        type: type === "booking.staff_assigned" ? "booking.staff_assigned" : "booking.updated",
        title: `Assigned Tour Update: ${ref}`,
        message: `Status for assigned tour ${serviceName} is now ${booking.status}.`,
        entityType: "booking",
        entityId: booking.id,
        actionUrl: `/dashboard/staff/bookings`,
        idempotencyKey: `notif_${booking.assignedStaff.id}_${booking.id}_${type}`,
        metadata: details?.extraMetadata,
      });
    }

    // 5. Resolve Affiliate Attribution Notifications
    const affiliateUserId = booking.affiliateAttribution?.affiliate?.user?.id;
    if (affiliateUserId && type === "booking.created") {
      await dispatchNotification({
        recipientUserId: affiliateUserId,
        type: "affiliate.commission_generated",
        title: `Affiliate Referral Recorded`,
        message: `A new booking ${ref} was made through your referral link.`,
        entityType: "booking",
        entityId: booking.id,
        actionUrl: `/dashboard/affiliate/bookings`,
        idempotencyKey: `notif_${affiliateUserId}_${booking.id}_referral`,
      });
    }
  } catch (err) {
    logger.error({ err, bookingId, type }, "Failed to resolve and send booking notifications");
  }
};

/**
 * Resolves recipients and dispatches notifications for payment verification/refund events.
 */
export const notifyPaymentEvent = async (
  bookingId: string,
  type: "payment.verified" | "payment.refunded" | "payment.failed",
  details?: { paymentId?: string; reason?: string },
): Promise<void> => {
  try {
    const booking = await notificationRepository.findBookingRecipients(bookingId);
    if (!booking) return;

    const ref = booking.id.slice(0, 8).toUpperCase();
    const adminIds = await notificationRepository.findActiveAdminUserIds();

    // 1. Notify Admins
    for (const adminId of adminIds) {
      await dispatchNotification({
        recipientUserId: adminId,
        type,
        title: type === "payment.verified" ? `Payment Verified: ${ref}` : `Payment ${humanize(type)}: ${ref}`,
        message: `Payment for booking ${ref} has been updated to ${type}.`,
        entityType: "payment",
        entityId: details?.paymentId || booking.id,
        actionUrl: `/dashboard/admin/payments`,
        idempotencyKey: `notif_${adminId}_${booking.id}_${type}_${details?.paymentId || ""}`,
      });
    }

    // 2. Notify Customer (if registered)
    if (!booking.isGuest && booking.customerId && booking.customer && booking.customer.status === "active") {
      const custTitle =
        type === "payment.verified"
          ? `Payment Confirmed: ${ref}`
          : type === "payment.refunded"
          ? `Payment Refunded: ${ref}`
          : `Payment Issue: ${ref}`;
      const custMsg =
        type === "payment.verified"
          ? `Your payment for booking ${ref} has been successfully verified.`
          : type === "payment.refunded"
          ? `A refund for booking ${ref} has been processed.`
          : `There was an issue processing payment for booking ${ref}.`;

      await dispatchNotification({
        recipientUserId: booking.customer.id,
        type,
        title: custTitle,
        message: custMsg,
        entityType: "payment",
        entityId: details?.paymentId || booking.id,
        actionUrl: `/dashboard/bookings/${booking.id}`,
        idempotencyKey: `notif_${booking.customer.id}_${booking.id}_${type}_${details?.paymentId || ""}`,
      });
    }

    // 3. Notify Agent
    if (booking.agentId && booking.agent && booking.agent.status === "active") {
      await dispatchNotification({
        recipientUserId: booking.agent.id,
        type,
        title: `Payment Update: ${ref}`,
        message: `Payment status for booking ${ref} is now ${type}.`,
        entityType: "payment",
        entityId: details?.paymentId || booking.id,
        actionUrl: `/dashboard/agent/bookings`,
        idempotencyKey: `notif_${booking.agent.id}_${booking.id}_${type}_${details?.paymentId || ""}`,
      });
    }
  } catch (err) {
    logger.error({ err, bookingId, type }, "Failed to process payment notifications");
  }
};

/**
 * Resolves recipients and dispatches notifications when staff is assigned to a tour.
 */
export const notifyStaffAssignment = async (
  bookingId: string,
  staffUserId: string,
): Promise<void> => {
  try {
    const booking = await notificationRepository.findBookingRecipients(bookingId);
    if (!booking) return;

    const ref = booking.id.slice(0, 8).toUpperCase();
    const serviceName = booking.service.name;

    await dispatchNotification({
      recipientUserId: staffUserId,
      type: "booking.staff_assigned",
      title: `New Assignment: ${serviceName}`,
      message: `You have been assigned to tour booking ${ref} for ${serviceName}.`,
      entityType: "assignment",
      entityId: booking.id,
      actionUrl: `/dashboard/staff/bookings`,
      idempotencyKey: `notif_assign_${staffUserId}_${booking.id}`,
    });
  } catch (err) {
    logger.error({ err, bookingId, staffUserId }, "Failed to send staff assignment notification");
  }
};

/**
 * Email notification pipeline preserved and integrated with email preferences.
 */
const notifyBookingParties = async (
  bookingId: string,
  event: NotificationEventValue,
  subject: string,
  compose: (context: MessageContext) => string,
  attachments?: MailAttachment[],
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

    interface Recipient {
      userId?: string;
      name: string;
      email: string;
    }
    const recipients: Recipient[] = [];

    if (booking.isGuest && booking.guestSnapshot) {
      recipients.push({
        name: booking.guestSnapshot.guestName,
        email: booking.guestSnapshot.guestEmail,
      });
    } else if (booking.customer && booking.customer.status === "active") {
      recipients.push({
        userId: booking.customer.id,
        name: booking.customer.name,
        email: booking.customer.email,
      });
    }

    if (booking.agent && booking.agent.status === "active") {
      recipients.push({
        userId: booking.agent.id,
        name: booking.agent.name,
        email: booking.agent.email,
      });
    }

    for (const recipient of recipients) {
      try {
        if (recipient.userId) {
          const userPref = await notificationRepository.getPreferences(recipient.userId);
          if (
            (event === "BOOKING_CONFIRMATION" || event === "BOOKING_STATUS_CHANGE") &&
            userPref.bookingEmail === false
          ) {
            continue;
          }
          if (event === "PAYMENT_CONFIRMATION" && userPref.paymentEmail === false) {
            continue;
          }
        }

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
          attachments,
        });
      } catch (error) {
        logger.error({ err: error, bookingId, event }, "Failed to send booking email notification");
      }
    }
  } catch (error) {
    logger.error({ err: error, bookingId, event }, "Failed to process booking email notification");
  }
};

export const notifyBookingCreated = async (bookingId: string): Promise<void> => {
  // 1. Dispatch in-app persistent notifications
  await notifyBookingEvent(bookingId, "booking.created");
  // 2. Dispatch email notifications
  await notifyBookingParties(bookingId, "BOOKING_CONFIRMATION", "Your booking has been received", (c) => {
    const state =
      c.status === "AWAITING_APPROVAL"
        ? "is awaiting price approval"
        : c.status === "CONFIRMED"
          ? "is confirmed"
          : "has been received";
    return `Hello ${c.recipientName},\n\nYour booking for ${c.serviceName} ${state}.`;
  });
};

export const notifyBookingStatusChanged = async (bookingId: string): Promise<void> => {
  try {
    const setting = await notificationRepository.findSetting("BOOKING_STATUS_CHANGE");
    if (setting && !setting.enabled) {
      return;
    }
  } catch {
    // Ignore DB check failure in isolated unit tests
  }
  // 1. Dispatch in-app persistent notifications
  await notifyBookingEvent(bookingId, "booking.updated");
  // 2. Dispatch email notifications
  await notifyBookingParties(bookingId, "BOOKING_STATUS_CHANGE", "Your booking status has changed", (c) =>
    `Hello ${c.recipientName},\n\nYour booking for ${c.serviceName} is now ${humanize(c.status)}.`,
  );
};

export const notifyPaymentDecision = async (
  bookingId: string,
  outcome: "CONFIRMED" | "REJECTED",
  paymentId?: string,
): Promise<void> => {
  const isConfirmed = outcome === "CONFIRMED";
  const type = isConfirmed ? "payment.verified" : "payment.failed";

  // 1. Dispatch in-app persistent notifications
  await notifyPaymentEvent(bookingId, type, { paymentId });

  let attachments: MailAttachment[] | undefined;

  // For confirmed payments, generate or retrieve the official payment receipt PDF
  if (outcome === "CONFIRMED") {
    try {
      const receipt = await getOrCreatePaymentReceipt(bookingId, paymentId);
      attachments = [
        {
          filename: receipt.filename,
          content: receipt.pdfBuffer,
          contentType: "application/pdf",
        },
      ];
    } catch (err: any) {
      logger.error(
        { bookingId, paymentId, err: err?.message || err },
        "Failed to generate payment receipt PDF for email attachment; proceeding without attachment",
      );
    }
  }

  return notifyBookingParties(
    bookingId,
    "PAYMENT_CONFIRMATION",
    outcome === "CONFIRMED" ? "Your payment has been confirmed" : "Your payment could not be verified",
    (c) =>
      outcome === "CONFIRMED"
        ? `Hello ${c.recipientName},\n\nWe have confirmed the payment for your ${c.serviceName} booking. Please find your official payment receipt attached.\n\nThank you for choosing PhuketTours!`
        : `Hello ${c.recipientName},\n\nWe could not verify the payment for your ${c.serviceName} booking. Please contact us or submit a new payment.`,
    attachments,
  );
};

export const notifyOperationalUpdate = async (bookingId: string): Promise<void> => {
  // 1. Dispatch in-app persistent notifications
  await notifyBookingEvent(bookingId, "booking.updated");
  // 2. Dispatch email notifications
  await notifyBookingParties(bookingId, "OPERATIONAL_UPDATE", "An update on your booking", (c) =>
    `Hello ${c.recipientName},\n\nYour ${c.serviceName} booking is now ${humanize(c.fulfillmentStatus)}.`,
  );
};

export const notifyGuestBookingAccess = async (
  bookingId: string,
  guestAccessUrl: string,
  expiresAtIso?: string,
): Promise<void> => {
  const expiryFormatted = expiresAtIso
    ? new Date(expiresAtIso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "30 days";

  return notifyBookingParties(
    bookingId,
    "BOOKING_CONFIRMATION",
    "Your PhuketTours Booking Access Link",
    (c) =>
      `Hello ${c.recipientName},\n\n` +
      `Thank you for booking your Phuket experience with us!\n\n` +
      `Booking Reference: ${bookingId.substring(0, 8).toUpperCase()}\n` +
      `Experience: ${c.serviceName}\n\n` +
      `You can view your full itinerary and manage your booking anytime without an account using your secure access link:\n` +
      `${guestAccessUrl}\n\n` +
      `This link is valid until ${expiryFormatted}. Please keep this email safe.\n\n` +
      `If you have questions or need to modify your booking, our support team is available at support@phukettours.com.\n\n` +
      `Warm regards,\nThe PhuketTours Team`,
  );
};

// Endpoints backing services
export const getUserNotifications = async (userId: string, filters: NotificationQueryFilters) => {
  return notificationRepository.listUserNotifications(userId, filters);
};

export const getUnreadCount = async (userId: string): Promise<{ unreadCount: number }> => {
  const count = await notificationRepository.countUnreadNotifications(userId);
  return { unreadCount: count };
};

export const markAsRead = async (id: string, userId: string) => {
  const notification = await notificationRepository.markNotificationAsRead(id, userId);
  return notification;
};

export const markAllAsRead = async (userId: string): Promise<{ markedCount: number }> => {
  const count = await notificationRepository.markAllNotificationsAsRead(userId);
  return { markedCount: count };
};

export const getUserPreferences = async (userId: string) => {
  return notificationRepository.getPreferences(userId);
};

export const setUserPreferences = async (userId: string, input: NotificationPreferencesInput) => {
  return notificationRepository.updatePreferences(userId, input);
};
