import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bookingService from "../../bookingService.js";
import * as bookingRepository from "../../bookingRepository.js";
import AppError from "../../../../shared/utils/AppError.js";

describe("Admin Pending Reservations Service Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listAdminPendingReservations", () => {
    it("lists pending reservations with pagination and filters", async () => {
      const mockResult = {
        items: [
          {
            id: "b-1",
            status: "PENDING",
            paymentStatus: "UNPAID",
            finalPrice: 200,
            currency: "USD",
            customer: { id: "c-1", name: "John Doe", email: "john@example.com" },
            service: { id: "s-1", name: "Phi Phi Luxury Day Tour" },
          },
        ],
        total: 1,
      };

      vi.spyOn(bookingRepository, "listPendingReservations").mockResolvedValue(mockResult as any);

      const res = await bookingService.listAdminPendingReservations({ page: 1, limit: 10, paymentStatus: "UNPAID" });
      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
      expect(res.limit).toBe(10);
    });
  });

  describe("reviewPendingReservation", () => {
    it("confirms an eligible pending booking", async () => {
      const mockUpdated = {
        id: "b-1",
        status: "CONFIRMED",
        paymentStatus: "PAID",
      };

      vi.spyOn(bookingRepository, "confirmPendingBooking").mockResolvedValue(mockUpdated as any);

      const res = await bookingService.reviewPendingReservation(
        "b-1",
        { action: "CONFIRM", notes: "Verified reservation" },
        "admin-1"
      );

      expect(res.status).toBe("CONFIRMED");
    });

    it("rejects an eligible pending booking", async () => {
      const mockUpdated = {
        id: "b-1",
        status: "CANCELLED",
      };

      vi.spyOn(bookingRepository, "rejectPendingBooking").mockResolvedValue(mockUpdated as any);

      const res = await bookingService.reviewPendingReservation(
        "b-1",
        { action: "REJECT", notes: "Customer requested cancellation" },
        "admin-1"
      );

      expect(res.status).toBe("CANCELLED");
    });

    it("throws 404 if booking does not exist", async () => {
      vi.spyOn(bookingRepository, "confirmPendingBooking").mockResolvedValue(null);

      await expect(
        bookingService.reviewPendingReservation("b-none", { action: "CONFIRM" }, "admin-1")
      ).rejects.toThrow("Booking not found");
    });
  });

  describe("getAdminBookingHistory & getStaffBookingHistory", () => {
    it("retrieves paginated booking history with actor info", async () => {
      const mockHistory = {
        items: [
          {
            id: "h-1",
            bookingId: "b-1",
            actorId: "admin-1",
            actorName: "Admin User",
            actorRole: "admin",
            action: "BOOKING_CONFIRMED",
            changes: { previousStatus: "PENDING", newStatus: "CONFIRMED", notes: "Approved" },
            createdAt: new Date("2026-11-09T10:00:00Z"),
          },
        ],
        total: 1,
      };

      vi.spyOn(bookingRepository, "findBookingHistory").mockResolvedValue(mockHistory as any);

      const res = await bookingService.getAdminBookingHistory("b-1", { page: 1, limit: 25 });
      expect(res.items).toHaveLength(1);
      expect(res.items[0].action).toBe("BOOKING_CONFIRMED");
      expect(res.items[0].actorName).toBe("Admin User");
      expect(res.page).toBe(1);
      expect(res.limit).toBe(25);
      expect(res.total).toBe(1);
    });

    it("throws 404 when booking history is requested for a non-existent booking", async () => {
      vi.spyOn(bookingRepository, "findBookingHistory").mockResolvedValue(null);

      await expect(
        bookingService.getAdminBookingHistory("b-missing", {})
      ).rejects.toThrow("Booking not found");
    });

    it("restricts staff booking history to bookings assigned to that staff member", async () => {
      vi.spyOn(bookingRepository, "findBookingHistory").mockResolvedValue(null);

      await expect(
        bookingService.getStaffBookingHistory("staff-other", "b-1", {})
      ).rejects.toThrow("Booking not found");

      expect(bookingRepository.findBookingHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: "b-1",
          assignedStaffId: "staff-other",
        })
      );
    });
  });
});

