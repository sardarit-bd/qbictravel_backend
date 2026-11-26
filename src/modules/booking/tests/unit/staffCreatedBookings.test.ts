import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bookingService from "../../bookingService.js";
import * as bookingRepository from "../../bookingRepository.js";

vi.mock("../../bookingRepository.js", () => ({
  listStaffCreatedBookings: vi.fn(),
  findBookingHistory: vi.fn(),
}));

describe("Staff Created Bookings Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("bookingService.listStaffCreatedBookings", () => {
    it("should query bookings where staffId is the creator with pagination and default values", async () => {
      const mockResult = {
        items: [
          {
            id: "booking-1",
            bookingReference: "BK-12345",
            createdById: "staff-uuid-1",
            status: "AWAITING_APPROVAL",
            paymentStatus: "UNPAID",
            discountRequests: [
              {
                id: "dr-1",
                discountType: "PERCENTAGE",
                discountValue: "10.00",
                discountAmount: "100.00",
                status: "PENDING",
              },
            ],
          },
        ],
        total: 1,
      };

      vi.mocked(bookingRepository.listStaffCreatedBookings).mockResolvedValue(mockResult as any);

      const result = await bookingService.listStaffCreatedBookings("staff-uuid-1", {
        page: 1,
        limit: 20,
      });

      expect(bookingRepository.listStaffCreatedBookings).toHaveBeenCalledWith("staff-uuid-1", {
        skip: 0,
        take: 20,
        scope: "my",
        status: undefined,
        paymentStatus: undefined,
        fulfillmentStatus: undefined,
        search: undefined,
      });
      expect(result).toEqual({
        items: mockResult.items,
        page: 1,
        limit: 20,
        total: 1,
      });
    });

    it("should forward filters to bookingRepository.listStaffCreatedBookings", async () => {
      const mockResult = {
        items: [],
        total: 0,
      };

      vi.mocked(bookingRepository.listStaffCreatedBookings).mockResolvedValue(mockResult as any);

      const result = await bookingService.listStaffCreatedBookings("staff-uuid-1", {
        page: 2,
        limit: 10,
        status: "AWAITING_APPROVAL" as any,
        paymentStatus: "UNPAID" as any,
        search: "BK-999",
      });

      expect(bookingRepository.listStaffCreatedBookings).toHaveBeenCalledWith("staff-uuid-1", {
        skip: 10,
        take: 10,
        scope: "my",
        status: "AWAITING_APPROVAL",
        paymentStatus: "UNPAID",
        fulfillmentStatus: undefined,
        search: "BK-999",
      });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });
  });

  describe("bookingService.getStaffBookingHistory permission check", () => {
    it("should return history if staff is the creator or assigned staff", async () => {
      const mockHistory = {
        items: [
          {
            id: "hist-1",
            bookingId: "booking-1",
            action: "BOOKING_CREATED_BY_STAFF",
            createdAt: new Date(),
          },
        ],
        total: 1,
      };

      vi.mocked(bookingRepository.findBookingHistory).mockResolvedValue(mockHistory as any);

      const result = await bookingService.getStaffBookingHistory("staff-uuid-1", "booking-1", {});

      expect(bookingRepository.findBookingHistory).toHaveBeenCalledWith({
        bookingId: "booking-1",
        assignedStaffId: "staff-uuid-1",
        skip: 0,
        take: 50,
      });
      expect(result.items).toEqual(mockHistory.items);
    });
  });
});
