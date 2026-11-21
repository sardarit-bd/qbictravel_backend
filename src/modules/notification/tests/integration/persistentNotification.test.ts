import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import * as notificationRepository from "../../notificationRepository.js";
import * as notificationService from "../../notificationService.js";
import { dashboardEventHub } from "../../../event/eventHub.js";

vi.mock("../../notificationRepository.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = (req.headers["x-mock-role"] as string) || "customer";
    const id = (req.headers["x-mock-user-id"] as string) || `${role}-1`;
    req.user = { id, role };
    next();
  },
}));

describe("Persistent Notifications API & Dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("API Endpoints", () => {
    it("GET /api/v1/notifications returns paginated notifications for current user", async () => {
      const mockResult = {
        items: [
          {
            id: "notif-1",
            recipientUserId: "customer-1",
            type: "booking.created",
            title: "Booking Received",
            message: "Your booking is confirmed",
            entityType: "booking",
            entityId: "b-1",
            isRead: false,
            createdAt: new Date().toISOString(),
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          unreadCount: 1,
        },
      };

      vi.mocked(notificationRepository.listUserNotifications).mockResolvedValue(mockResult as any);

      const res = await request(app)
        .get("/api/v1/notifications?page=1&limit=20")
        .set("x-mock-user-id", "customer-1")
        .set("x-mock-role", "customer");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(notificationRepository.listUserNotifications).toHaveBeenCalledWith("customer-1", {
        page: 1,
        limit: 20,
        isRead: undefined,
      });
    });

    it("GET /api/v1/notifications/unread-count returns unread count", async () => {
      vi.mocked(notificationRepository.countUnreadNotifications).mockResolvedValue(5);

      const res = await request(app)
        .get("/api/v1/notifications/unread-count")
        .set("x-mock-user-id", "agent-1")
        .set("x-mock-role", "agent");

      expect(res.status).toBe(200);
      expect(res.body.data.unreadCount).toBe(5);
    });

    it("PATCH /api/v1/notifications/:id/read marks notification as read", async () => {
      vi.mocked(notificationRepository.markNotificationAsRead).mockResolvedValue({
        id: "notif-1",
        recipientUserId: "customer-1",
        isRead: true,
      } as any);

      const res = await request(app)
        .patch("/api/v1/notifications/notif-1/read")
        .set("x-mock-user-id", "customer-1");

      expect(res.status).toBe(200);
      expect(res.body.data.isRead).toBe(true);
      expect(notificationRepository.markNotificationAsRead).toHaveBeenCalledWith("notif-1", "customer-1");
    });

    it("PATCH /api/v1/notifications/read-all marks all user notifications as read", async () => {
      vi.mocked(notificationRepository.markAllNotificationsAsRead).mockResolvedValue(4);

      const res = await request(app)
        .patch("/api/v1/notifications/read-all")
        .set("x-mock-user-id", "admin-1");

      expect(res.status).toBe(200);
      expect(res.body.data.markedCount).toBe(4);
    });

    it("GET & PUT /api/v1/notifications/preferences manages user preferences", async () => {
      vi.mocked(notificationRepository.getPreferences).mockResolvedValue({
        id: "pref-1",
        userId: "customer-1",
        bookingInApp: true,
        bookingEmail: false,
      } as any);

      const getRes = await request(app)
        .get("/api/v1/notifications/preferences")
        .set("x-mock-user-id", "customer-1");

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.bookingEmail).toBe(false);

      vi.mocked(notificationRepository.updatePreferences).mockResolvedValue({
        id: "pref-1",
        userId: "customer-1",
        bookingInApp: false,
        bookingEmail: false,
      } as any);

      const putRes = await request(app)
        .put("/api/v1/notifications/preferences")
        .set("x-mock-user-id", "customer-1")
        .send({ bookingInApp: false });

      expect(putRes.status).toBe(200);
      expect(notificationRepository.updatePreferences).toHaveBeenCalledWith("customer-1", {
        bookingInApp: false,
      });
    });
  });

  describe("Recipient Resolution & Idempotency", () => {
    it("dispatches persistent notifications to admins and customer on booking created", async () => {
      vi.mocked(notificationRepository.findBookingRecipients).mockResolvedValue({
        id: "b-12345678",
        isGuest: false,
        customerId: "cust-1",
        status: "CONFIRMED",
        paymentStatus: "PENDING",
        fulfillmentStatus: "NOT_STARTED",
        service: { name: "Phi Phi Island Tour" },
        customer: { id: "cust-1", name: "Alice", email: "alice@example.com", status: "active", role: "customer" },
        agent: null,
        assignedStaff: null,
      } as any);

      vi.mocked(notificationRepository.findActiveAdminUserIds).mockResolvedValue(["admin-1"]);
      vi.mocked(notificationRepository.getPreferences).mockResolvedValue({
        bookingInApp: true,
      } as any);

      vi.mocked(notificationRepository.createNotification).mockImplementation(async (input: any) => ({
        id: `notif-${input.recipientUserId}`,
        isRead: false,
        createdAt: new Date(),
        ...input,
      }));

      const publishSpy = vi.spyOn(dashboardEventHub, "publishEvent");

      await notificationService.notifyBookingEvent("b-12345678", "booking.created");

      // Verify admin and customer received persistent notification creations
      expect(notificationRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: "admin-1",
          type: "booking.created",
          idempotencyKey: "notif_admin-1_b-12345678_booking.created",
        }),
      );

      expect(notificationRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: "cust-1",
          type: "booking.created",
          idempotencyKey: "notif_cust-1_b-12345678_booking.created",
        }),
      );

      // Verify minimal SSE event was published for each notification
      expect(publishSpy).toHaveBeenCalledWith("notification.created", expect.any(String), expect.objectContaining({
        recipientUserId: "admin-1",
      }));
      expect(publishSpy).toHaveBeenCalledWith("notification.created", expect.any(String), expect.objectContaining({
        recipientUserId: "cust-1",
      }));
    });
  });
});
