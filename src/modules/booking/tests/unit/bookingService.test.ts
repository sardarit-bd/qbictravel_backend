import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bookingService from "../../bookingService.js";
import * as bookingRepository from "../../bookingRepository.js";
import * as pricingService from "../../../pricing/pricingService.js";
import { prisma } from "../../../../lib/prisma.js";
import AppError from "../../../../shared/utils/AppError.js";

// Explicitly mock prisma to ensure methods are vi.fn()
vi.mock("../../../notification/notificationService.js");
vi.mock("../../../../lib/prisma.js", () => ({
  prisma: {
    service: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../bookingRepository.js");
vi.mock("../../../pricing/pricingService.js");

describe("Booking Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createBooking (Customer)", () => {
    it("should throw 403 if customer tries to negotiate price", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [{ basePrice: 100, validFrom: null, validTo: null }],
      });

      await expect(
        bookingService.createBooking(
          { customerId: "c1", serviceId: "s1", proposedPrice: 90 },
          false,
          "c1"
        )
      ).rejects.toThrow(new AppError("Customers cannot negotiate price", 403));
    });

    it("should create a booking at base price for customer", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [{ basePrice: 100, validFrom: null, validTo: null }],
      });
      
      const mockBooking = { id: "b1", basePrice: 100, finalPrice: 100, status: "PENDING" };
      (bookingRepository.createBooking as any).mockResolvedValue(mockBooking);

      await bookingService.createBooking(
        { customerId: "c1", serviceId: "s1" },
        false,
        "c1"
      );

      expect(bookingRepository.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ basePrice: 100, finalPrice: 100, status: "PENDING" })
      );
    });

    it("should calculate multi-guest pricing and structured notes when guest quantities and travelDate are provided", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        metadata: {
          pricingTiers: [
            { tierName: "Adult", price: 120 },
            { tierName: "Child (4-11)", price: 80 },
            { tierName: "Infant (0-3)", price: 0 },
          ],
        },
        pricing: [
          {
            basePrice: 120,
            discountedPrice: 100,
            currency: "USD",
            validFrom: null,
            validTo: null,
          },
        ],
      });

      const mockBooking = {
        id: "b1",
        basePrice: 280,
        finalPrice: 280,
        status: "PENDING",
      };
      (bookingRepository.createBooking as any).mockResolvedValue(mockBooking);

      await bookingService.createBooking(
        {
          customerId: "c1",
          serviceId: "s1",
          travelDate: "2026-12-15",
          adults: 2,
          children: 1,
          infants: 1,
          notes: "Contact: John Doe (john@example.com, +66812345678)",
        },
        false,
        "c1"
      );

      // 2 adults * 100 (discountedPrice) + 1 child * 80 + 1 infant * 0 = 280
      expect(bookingRepository.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          basePrice: 280,
          finalPrice: 280,
          currency: "USD",
          status: "PENDING",
          notes:
            "Travel Date: 2026-12-15 | Guests: 2 Adults, 1 Child, 1 Infant | Contact: John Doe (john@example.com, +66812345678)",
        })
      );
    });

    it("should throw 400 when service has zero active pricing tiers", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [],
      });

      await expect(
        bookingService.createBooking({ customerId: "c1", serviceId: "s1" }, false, "c1")
      ).rejects.toThrow(new AppError("Service has no active pricing", 400));
    });

    it("should throw 409 when service has multiple active pricing tiers", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [
          { basePrice: 100, currency: "USD", validFrom: null, validTo: null },
          { basePrice: 120, currency: "THB", validFrom: null, validTo: null },
        ],
      });

      await expect(
        bookingService.createBooking({ customerId: "c1", serviceId: "s1" }, false, "c1")
      ).rejects.toThrow(
        new AppError("Service has multiple active pricing tiers. Please contact support.", 409)
      );
    });
  });

  describe("createBooking (Agent)", () => {
    beforeEach(() => {
      (bookingRepository.findActiveCustomer as any).mockResolvedValue({ id: "c1" });
    });

    it("should check that the customer exists and is active", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [{ basePrice: 100, validFrom: null, validTo: null }],
      });

      await expect(
        bookingService.createBooking({ customerId: "c1", serviceId: "s1" }, true, "a1")
      ).rejects.toThrow();

      expect(bookingRepository.findActiveCustomer).toHaveBeenCalledWith("c1");
    });

    it("should throw 400 if agent does not provide proposed price", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [{ basePrice: 100, validFrom: null, validTo: null }],
      });

      await expect(
        bookingService.createBooking({ customerId: "c1", serviceId: "s1" }, true, "a1")
      ).rejects.toThrow(new AppError("Agent must provide a proposed price", 400));
    });

    it("should auto-confirm if price is within agent limits", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [{ basePrice: 100, validFrom: null, validTo: null }],
      });
      (pricingService.getAgentPricingLimit as any).mockResolvedValue({
        maxDiscountPercentage: 10, // Min allowed = 90
        applicableRuleId: "r1",
      });
      
      const mockBooking = { id: "b1", basePrice: 100, finalPrice: 95, status: "CONFIRMED", requiresApproval: false };
      (bookingRepository.createBooking as any).mockResolvedValue(mockBooking);

      await bookingService.createBooking(
        { customerId: "c1", serviceId: "s1", proposedPrice: 95 },
        true,
        "a1"
      );

      expect(bookingRepository.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ status: "CONFIRMED", requiresApproval: false })
      );
    });

    it("should require approval if price is outside agent limits", async () => {
      (prisma.service.findUnique as any).mockResolvedValue({
        id: "s1",
        pricing: [{ basePrice: 100, validFrom: null, validTo: null }],
      });
      (pricingService.getAgentPricingLimit as any).mockResolvedValue({
        maxDiscountPercentage: 10, // Min allowed = 90
        applicableRuleId: "r1",
      });
      
      const mockBooking = { id: "b1", basePrice: 100, finalPrice: 80, status: "AWAITING_APPROVAL", requiresApproval: true, priceApproval: null };
      (bookingRepository.createBooking as any).mockResolvedValue(mockBooking);
      (bookingRepository.createPriceApproval as any).mockResolvedValue({ id: "pa1" });
      (bookingRepository.findBookingById as any).mockResolvedValue({ ...mockBooking, priceApproval: { id: "pa1" } });

      await bookingService.createBooking(
        { customerId: "c1", serviceId: "s1", proposedPrice: 80 },
        true,
        "a1"
      );

      expect(bookingRepository.createPriceApproval).toHaveBeenCalledWith("b1", 80);
      expect(bookingRepository.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({ status: "AWAITING_APPROVAL", requiresApproval: true })
      );
    });
  });

  describe("reviewBookingPrice", () => {
    it("should throw 400 if booking is not awaiting approval", async () => {
      (bookingRepository.findBookingById as any).mockResolvedValue({
        id: "b1",
        requiresApproval: false,
        status: "CONFIRMED",
      });

      await expect(
        bookingService.reviewBookingPrice("b1", { status: "APPROVED", approvedPrice: 80 }, "admin1")
      ).rejects.toThrow(new AppError("This booking does not require price approval", 400));
    });
  });
});