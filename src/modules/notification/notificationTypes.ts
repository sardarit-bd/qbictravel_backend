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