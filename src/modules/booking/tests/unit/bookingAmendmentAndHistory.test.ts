import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import * as bookingRepository from "../../bookingRepository.js";
import * as bookingService from "../../bookingService.js";

vi.mock("../../../../lib/prisma.js", () => {
  const mockPrisma = {
    booking: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    guestBookingSnapshot: {
      updateMany: vi.fn(),
    },
    serviceAvailability: {
      upsert: vi.fn(),
    },
    payment: {
      aggregate: vi.fn(),
    },
    invoice: {
      updateMany: vi.fn(),
    },
    staffDiscountRequest: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    staffDiscountAuditEvent: {
      create: vi.fn(),
    },
    bookingHistory: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

vi.mock("../../bookingRepository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../bookingRepository.js")>();
  return {
    ...actual,
    amendBookingRecord: vi.fn(),
    cancelBookingRecord: vi.fn(),
    listAllBookingActivities: vi.fn(),
  };
});

describe("Booking Amendment & Activity History Service Tests", () => {
  const staffId = "staff-uuid-1234";
  const bookingId = "booking-uuid-7777";

  const mockExistingBooking = {
    id: bookingId,
    customerId: "cust-1",
    serviceId: "service-1",
    availabilityId: "avail-1",
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    basePrice: 100,
    finalPrice: 100,
    currency: "USD",
    notes: "Travel Date: 2026-12-01 | Guests: 1 Adult | Pickup: Patong Hotel",
    customer: {
      id: "cust-1",
      name: "John Traveler",
      email: "john@example.com",
      phone: "+6612345678",
    },
    service: {
      id: "service-1",
      pricing: [
        {
          id: "pricing-1",
          basePrice: 100,
          discountedPrice: null,
          currency: "USD",
        },
      ],
      metadata: {
        pricingTiers: [
          { tierName: "Adult", price: 100 },
          { tierName: "Child", price: 70 },
          { tierName: "Infant", price: 0 },
        ],
      },
    },
    availability: {
      id: "avail-1",
      date: new Date("2026-12-01"),
    },
    payments: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("amendStaffBooking", () => {
    it("successfully calculates new passenger pricing and passes amendment data to repository", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(mockExistingBooking as any);
      vi.mocked(bookingRepository.amendBookingRecord).mockResolvedValue({
        id: bookingId,
        status: "CONFIRMED",
        basePrice: 270, // 2 adults (200) + 1 child (70)
        finalPrice: 270,
      } as any);

      const result = await bookingService.amendStaffBooking(
        bookingId,
        {
          adults: 2,
          children: 1,
          pickupLocation: "Kata Beach Resort",
        },
        staffId,
        "staff"
      );

      expect(result.id).toBe(bookingId);
      expect(bookingRepository.amendBookingRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          actorId: staffId,
          actorRole: "staff",
          adults: 2,
          children: 1,
          newBasePrice: 270,
          newFinalPrice: 270,
        })
      );
    });

    it("successfully amends a package-based booking (e.g. AquaThrill / Jet Ski / Sirey Elephants) with packageId and zone", async () => {
      const mockPackageBooking = {
        ...mockExistingBooking,
        packageId: "pkg-speedboat-1",
        pickupZoneId: "zone-patong",
        service: {
          ...mockExistingBooking.service,
          pricingType: "PER_PACKAGE",
          packages: [
            {
              id: "pkg-speedboat-1",
              name: "Catamaran 35ft Private Charter",
              sellingPrice: 15000,
              netPrice: 12000,
              currency: "THB",
              minPax: 1,
              maxCapacity: 15,
              isActive: true,
            },
          ],
          timeSlots: [
            {
              id: "slot-morning",
              name: "Morning Tour",
              departureTime: "08:30 AM",
              isActive: true,
            },
          ],
          pickupZones: [
            {
              id: "zone-patong",
              zoneName: "Patong Beach",
              surchargeAmount: 0,
              hasPrivateTransfer: true,
              privateTransferCharge: 1600,
              isActive: true,
            },
          ],
        },
      };

      vi.mocked(prisma.booking.findUnique).mockResolvedValue(mockPackageBooking as any);
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockPackageBooking.service as any);
      vi.mocked(bookingRepository.amendBookingRecord).mockResolvedValue({
        id: bookingId,
        status: "CONFIRMED",
        basePrice: 15000,
        finalPrice: 15000,
      } as any);

      const result = await bookingService.amendStaffBooking(
        bookingId,
        {
          packageId: "pkg-speedboat-1",
          timeSlotId: "slot-morning",
          pickupZoneId: "zone-patong",
          adults: 6,
          pickupLocation: "Hilton Phuket Resort",
        },
        staffId,
        "admin"
      );

      expect(result.id).toBe(bookingId);
      expect(bookingRepository.amendBookingRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          actorId: staffId,
          actorRole: "admin",
          packageId: "pkg-speedboat-1",
          timeSlotId: "slot-morning",
          pickupZoneId: "zone-patong",
          adults: 6,
          newBasePrice: 15000,
          newFinalPrice: 15000,
        })
      );
    });

    it("rejects amendment on cancelled bookings", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue({
        ...mockExistingBooking,
        status: "CANCELLED",
      } as any);

      await expect(
        bookingService.amendStaffBooking(bookingId, { adults: 2 }, staffId, "staff")
      ).rejects.toThrow("Cannot amend a cancelled or failed booking");
    });
  });

  describe("cancelStaffBooking", () => {
    it("cancels booking and calls cancelBookingRecord with parsed guest count", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(mockExistingBooking as any);
      vi.mocked(bookingRepository.cancelBookingRecord).mockResolvedValue({
        id: bookingId,
        status: "CANCELLED",
      } as any);

      const result = await bookingService.cancelStaffBooking(
        bookingId,
        staffId,
        "staff",
        "Customer requested cancellation due to weather"
      );

      expect(result.status).toBe("CANCELLED");
      expect(bookingRepository.cancelBookingRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          actorId: staffId,
          actorRole: "staff",
          reason: "Customer requested cancellation due to weather",
        })
      );
    });
  });

  describe("getAdminActivityHistory", () => {
    it("returns paginated activity records with total pages", async () => {
      vi.mocked(bookingRepository.listAllBookingActivities).mockResolvedValue({
        items: [
          {
            id: "hist-1",
            bookingId: "b-1",
            actorId: staffId,
            actorName: "Staff Alice",
            actorEmail: "alice@phuket.com",
            actorRole: "staff",
            action: "BOOKING_AMENDED",
            changes: { previousFinalPrice: 100, newFinalPrice: 150 },
            createdAt: new Date(),
            booking: {
              id: "b-1",
              status: "CONFIRMED",
              finalPrice: 150,
              currency: "USD",
              customer: { id: "c-1", name: "Guest Bob", email: "bob@example.com" },
              service: { id: "s-1", name: "Phi Phi Island Speedboat" },
            },
          },
        ] as any,
        total: 1,
      });

      const res = await bookingService.getAdminActivityHistory({ page: 1, limit: 10 });
      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
      expect(res.totalPages).toBe(1);
      expect(res.items[0].action).toBe("BOOKING_AMENDED");
    });
  });
});
