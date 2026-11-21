import { prisma } from "../../lib/prisma.js";
import type {
  CreateNotificationInput,
  NotificationEventValue,
  NotificationPreferencesInput,
  NotificationQueryFilters,
  NotificationSettingItem,
} from "./notificationTypes.js";

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
    include: {
      service: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, email: true, status: true, role: true } },
      agent: { select: { id: true, name: true, email: true, status: true, role: true } },
      assignedStaff: { select: { id: true, name: true, email: true, status: true, role: true } },
      affiliateAttribution: {
        select: {
          affiliateId: true,
          affiliate: {
            select: {
              userId: true,
              user: { select: { id: true, name: true, email: true, status: true } },
            },
          },
        },
      },
      guestSnapshot: {
        select: {
          guestName: true,
          guestEmail: true,
          guestPhone: true,
        },
      },
    },
  });
};

export const findActiveAdminUserIds = async (): Promise<string[]> => {
  const admins = await prisma.user.findMany({
    where: {
      role: "admin",
      status: "active",
      deletedAt: null,
    },
    select: { id: true },
  });
  return admins.map((a) => a.id);
};

export const createNotification = async (input: CreateNotificationInput) => {
  if (input.idempotencyKey) {
    const existing = await prisma.notification.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return existing;
    }
  }

  return prisma.notification.create({
    data: {
      recipientUserId: input.recipientUserId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      actionUrl: input.actionUrl,
      metadata: (input.metadata ?? {}) as any,
      idempotencyKey: input.idempotencyKey,
    },
  });
};

export const listUserNotifications = async (
  userId: string,
  filters: NotificationQueryFilters = {},
) => {
  const page = Math.max(filters.page || 1, 1);
  const limit = Math.min(Math.max(filters.limit || 20, 1), 50);
  const skip = (page - 1) * limit;

  const where: any = {
    recipientUserId: userId,
  };

  if (typeof filters.isRead === "boolean") {
    where.isRead = filters.isRead;
  }

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: {
        recipientUserId: userId,
        isRead: false,
      },
    }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      unreadCount,
    },
  };
};

export const countUnreadNotifications = async (userId: string): Promise<number> => {
  return prisma.notification.count({
    where: {
      recipientUserId: userId,
      isRead: false,
    },
  });
};

export const markNotificationAsRead = async (id: string, userId: string) => {
  const notification = await prisma.notification.findFirst({
    where: {
      id,
      recipientUserId: userId,
    },
  });

  if (!notification) {
    return null;
  }

  if (notification.isRead) {
    return notification;
  }

  return prisma.notification.update({
    where: { id },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
};

export const markAllNotificationsAsRead = async (userId: string): Promise<number> => {
  const result = await prisma.notification.updateMany({
    where: {
      recipientUserId: userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
  return result.count;
};

export const getPreferences = async (userId: string) => {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  if (pref) return pref;

  return {
    id: "default",
    userId,
    bookingInApp: true,
    paymentInApp: true,
    commissionInApp: true,
    assignmentInApp: true,
    bookingEmail: true,
    paymentEmail: true,
    commissionEmail: true,
    assignmentEmail: true,
    updatedAt: new Date(),
  };
};

export const updatePreferences = async (
  userId: string,
  input: NotificationPreferencesInput,
) => {
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      ...input,
    },
    update: {
      ...input,
    },
  });
};
