export const NOTIFICATION_EVENTS = [
  "BOOKING_CONFIRMATION",
  "BOOKING_STATUS_CHANGE",
  "PAYMENT_CONFIRMATION",
  "OPERATIONAL_UPDATE",
] as const;

export type NotificationEventValue = (typeof NOTIFICATION_EVENTS)[number];

export interface NotificationSettingItem {
  event: NotificationEventValue;
  enabled: boolean;
}

export interface UpdateNotificationSettingsInput {
  settings: NotificationSettingItem[];
}

export interface MessageContext {
  recipientName: string;
  serviceName: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
}

export type PersistentNotificationType =
  // Booking
  | "booking.created"
  | "booking.updated"
  | "booking.approved"
  | "booking.rejected"
  | "booking.cancelled"
  | "booking.completed"
  // Payment
  | "payment.verified"
  | "payment.refunded"
  | "payment.failed"
  // Staff
  | "booking.staff_assigned"
  | "booking.assignment_updated"
  // Agent
  | "agent.booking_created"
  | "agent.price_approved"
  | "agent.price_rejected"
  | "agent.commission_generated"
  | "agent.commission_approved"
  | "agent.payout_processed"
  // Affiliate
  | "affiliate.commission_generated"
  | "affiliate.payout_processed";

export interface CreateNotificationInput {
  recipientUserId: string;
  type: PersistentNotificationType;
  title: string;
  message: string;
  entityType: "booking" | "payment" | "commission" | "assignment" | string;
  entityId: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface NotificationQueryFilters {
  page?: number;
  limit?: number;
  isRead?: boolean;
}

export interface NotificationPreferencesInput {
  bookingInApp?: boolean;
  paymentInApp?: boolean;
  commissionInApp?: boolean;
  assignmentInApp?: boolean;
  bookingEmail?: boolean;
  paymentEmail?: boolean;
  commissionEmail?: boolean;
  assignmentEmail?: boolean;
}
