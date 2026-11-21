import * as yup from "yup";
import { NOTIFICATION_EVENTS } from "./notificationTypes.js";

export const updateNotificationSettingsSchema = yup.object({
  settings: yup
    .array()
    .of(
      yup.object({
        event: yup
          .string()
          .oneOf([...NOTIFICATION_EVENTS], "Invalid notification event")
          .required("Event is required"),
        enabled: yup.boolean().required("Enabled flag is required"),
      }),
    )
    .min(1, "At least one setting is required")
    .test("unique-events", "Each event may appear only once", (value) => {
      if (!value) return true;
      const events = value.map((item) => item.event);
      return new Set(events).size === events.length;
    })
    .required("Settings are required"),
});

export const listNotificationsQuerySchema = yup.object({
  page: yup.number().integer().min(1).default(1),
  limit: yup.number().integer().min(1).max(50).default(20),
  isRead: yup.boolean().optional(),
});

export const updatePreferencesSchema = yup.object({
  bookingInApp: yup.boolean().optional(),
  paymentInApp: yup.boolean().optional(),
  commissionInApp: yup.boolean().optional(),
  assignmentInApp: yup.boolean().optional(),
  bookingEmail: yup.boolean().optional(),
  paymentEmail: yup.boolean().optional(),
  commissionEmail: yup.boolean().optional(),
  assignmentEmail: yup.boolean().optional(),
});
