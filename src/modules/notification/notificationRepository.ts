import { prisma } from "../../lib/prisma.js";
import type { NotificationEventValue, NotificationSettingItem } from "./notificationTypes.js";

export const listSettings = async () => {
  return prisma.notificationSetting.findMany({
    select: { event: true, enabled: true, updatedAt: true },
  });
};

export const findSetting = async (event: NotificationEventValue) => {
  return prisma.notificationSetting.findUnique({
    where: { event },
    select: { enabled: true },
  });
};

export const upsertSettings = async (items: NotificationSettingItem[], adminId: string) => {
  return prisma.$transaction(
    items.map((item) =>
      prisma.notificationSetting.upsert({
        where: { event: item.event },
        create: { event: item.event, enabled: item.enabled, updatedById: adminId },
        update: { enabled: item.enabled, updatedById: adminId },
      }),
    ),
  );
};

export const findBookingRecipients = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      service: { select: { name: true } },
      customer: { select: { name: true, email: true, status: true } },
      agent: { select: { name: true, email: true, status: true } },
    },
  });
};