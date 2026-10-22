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