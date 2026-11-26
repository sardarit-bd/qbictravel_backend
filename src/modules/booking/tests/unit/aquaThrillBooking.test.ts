import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateBookingPricing, createBooking, createGuestBooking } from "../../bookingService.js";
import { prisma } from "../../../../lib/prisma.js";
import * as bookingRepository from "../../bookingRepository.js";
import AppError from "../../../../shared/utils/AppError.js";

// Mock prisma and bookingRepository for fast, isolated unit tests
vi.mock("../../../../lib/prisma.js", () => {
  return {
    prisma: {
      service: {
        findUnique: vi.fn(),
      },
      serviceAvailability: {
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (cb: any) => cb({
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([{ id: "avail-1", bookedCount: 1, capacity: 50 }]),
        serviceAvailability: {
          findUnique: vi.fn().mockResolvedValue({ isAvailable: true, capacity: 50, bookedCount: 1 }),
        },
        guestBookingSnapshot: { create: vi.fn().mockResolvedValue({}) },
        guestBookingToken: { create: vi.fn().mockResolvedValue({}) },
        paymentLink: { create: vi.fn().mockResolvedValue({ tokenHash: "hash" }) },
        booking: { create: vi.fn() },
        bookingHistory: { create: vi.fn() },
      })),
    },
  };
});

vi.mock("../../bookingRepository.js", () => {
  return {
    findActiveCustomer: vi.fn().mockResolvedValue({ id: "cust-1", name: "John Doe" }),
    createBooking: vi.fn().mockImplementation((input: any) => ({
      id: "booking-123",
      status: "PENDING",
      ...input,
    })),
    createPriceApproval: vi.fn(),
    findBookingById: vi.fn(),
  };
});

vi.mock("../../../customer/customerHelper.js", () => {
  return {
    resolveOrCreateCustomer: vi.fn().mockResolvedValue({ id: "cust-1", name: "Guest User", email: "guest@example.com" }),
  };
});

vi.mock("../../../notification/notificationService.js", () => {
  return {
    notifyBookingCreated: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../../event/eventEmitter.js", () => {
  return {
    emitBookingEvent: vi.fn().mockResolvedValue(undefined),
  };
});

describe("AquaThrill Tour Package & Pricing Engine Unit Tests", () => {
  const aquaThrillServiceId = "service-aquathrill-uuid";
  const standardTourServiceId = "service-standard-uuid";

  const mockAquaThrillService = {
    id: aquaThrillServiceId,
    name: "AquaThrill Private Jet Boat Experience",
    type: "TOUR",
    status: "PUBLISHED",
    pricingType: "PER_PACKAGE",
    providerName: "AquaThrill",
    pricing: [
      {
        id: "p-1",
        currency: "THB",
        basePrice: 3500,
        discountedPrice: null,
        taxRate: 7.00, // 7% VAT configured
        validFrom: null,
        validTo: null,
      },
    ],
    packages: [
      {
        id: "pkg-1h-12ft",
        serviceId: aquaThrillServiceId,
        name: "1-Hour Jet Boat Charter",
        durationMinutes: 60,
        boatSize: "12 Ft",
        minPax: 1,
        maxCapacity: 2,
        sellingPrice: 3500.00,
        netPrice: 2800.00,
        currency: "THB",
        isActive: true,
        sortOrder: 1,
      },
      {
        id: "pkg-4h-17ft",
        serviceId: aquaThrillServiceId,
        name: "4-Hour VIP Jet Boat Charter",
        durationMinutes: 240,
        boatSize: "17 Ft",
        minPax: 1,
        maxCapacity: 6,
        sellingPrice: 11900.00,
        netPrice: 8500.00,
        currency: "THB",
        isActive: true,
        sortOrder: 5,
      },
      {
        id: "pkg-inactive",
        serviceId: aquaThrillServiceId,
        name: "Old Expired Package",
        durationMinutes: 60,
        boatSize: "10 Ft",
        minPax: 1,
        maxCapacity: 2,
        sellingPrice: 2000.00,
        netPrice: 1500.00,
        currency: "THB",
        isActive: false,
        sortOrder: 9,
      },
    ],
    timeSlots: [
      {
        id: "slot-morning",
        serviceId: aquaThrillServiceId,
        name: "Morning Session",
        departureTime: "09:00",
        capacity: 2,
        isActive: true,
        sortOrder: 1,
      },
      {
        id: "slot-inactive",
        serviceId: aquaThrillServiceId,
        name: "Maintenance Session",
        departureTime: "12:00",
        capacity: 2,
        isActive: false,
        sortOrder: 2,
      },
    ],
    pickupZones: [
      {
        id: "zone-patong",
        serviceId: aquaThrillServiceId,
        zoneName: "Patong / Kata / Karon",
        surchargeAmount: 0.00,
        surchargeUnit: "PER_BOOKING",
        currency: "THB",
        isActive: true,
        sortOrder: 1,
      },
      {
        id: "zone-rawai",
        serviceId: aquaThrillServiceId,
        zoneName: "Rawai / Nai Harn",
        surchargeAmount: 500.00,
        surchargeUnit: "PER_BOOKING",
        currency: "THB",
        isActive: true,
        sortOrder: 2,
      },
      {
        id: "zone-inactive",
        serviceId: aquaThrillServiceId,
        zoneName: "Closed Zone",
        surchargeAmount: 800.00,
        surchargeUnit: "PER_BOOKING",
        currency: "THB",
        isActive: false,
        sortOrder: 3,
      },
    ],
  };

  const mockStandardService = {
    id: standardTourServiceId,
    name: "Phi Phi Island Day Tour",
    type: "TOUR",
    status: "PUBLISHED",
    pricingType: "PER_PERSON",
    providerName: "Generic Provider",
    metadata: {
      pricingTiers: [
        { tierName: "Child", price: 1000 },
        { tierName: "Infant", price: 0 },
      ],
    },
    pricing: [
      {
        id: "p-std",
        currency: "THB",
        basePrice: 2000,
        discountedPrice: null,
        taxRate: 0,
        validFrom: null,
        validTo: null,
      },
    ],
    packages: [],
    timeSlots: [],
    pickupZones: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. PER_PACKAGE Flat Pricing vs PER_PERSON Verification", () => {
    it("charges flat package selling price once, NOT multiplied by passenger count", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      // 2 adults booking a 1-Hour 12 Ft boat
      const result = await evaluateBookingPricing(aquaThrillServiceId, {
        packageId: "pkg-1h-12ft",
        adults: 2,
        children: 0,
      });

      // Selling price is 3,500 THB flat, VAT 7% = 245 THB, total = 3,745 THB
      expect(result.packagePriceSnapshot).toBe(3500.00);
      expect(result.netPriceSnapshot).toBe(2800.00);
      expect(result.pickupSurcharge).toBe(0);
      expect(result.taxAmount).toBe(245.00);
      expect(result.finalPrice).toBe(3745.00);
      expect(result.currency).toBe("THB");
    });

    it("leaves legacy PER_PERSON tours multiplying adult & child rates correctly", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockStandardService as any);

      const result = await evaluateBookingPricing(standardTourServiceId, {
        adults: 2,
        children: 1,
        infants: 1,
      });

      // 2 * 2000 + 1 * 1000 + 0 = 5000 THB
      expect(result.basePrice).toBe(5000);
      expect(result.finalPrice).toBe(5000);
      expect(result.packagePriceSnapshot).toBeNull();
      expect(result.netPriceSnapshot).toBeNull();
    });
  });

  describe("2. Passenger Capacity Validation", () => {
    it("rejects booking if total passenger count exceeds package maxCapacity", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      // 12 Ft boat max capacity is 2 pax; requesting 3 pax
      await expect(
        evaluateBookingPricing(aquaThrillServiceId, {
          packageId: "pkg-1h-12ft",
          adults: 2,
          children: 1,
        })
      ).rejects.toThrow(/accommodates a maximum of 2 passengers/);
    });

    it("accepts booking when passenger count is within 17 Ft boat capacity (up to 6 pax)", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      const result = await evaluateBookingPricing(aquaThrillServiceId, {
        packageId: "pkg-4h-17ft",
        adults: 4,
        children: 2,
      });

      expect(result.packagePriceSnapshot).toBe(11900.00);
      expect(result.netPriceSnapshot).toBe(8500.00);
    });
  });

  describe("3. Package, TimeSlot & PickupZone Relation Validation", () => {
    it("rejects invalid or cross-service package ID", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      await expect(
        evaluateBookingPricing(aquaThrillServiceId, {
          packageId: "foreign-or-nonexistent-pkg",
        })
      ).rejects.toThrow("Selected package does not belong to this service");
    });

    it("rejects inactive packages", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      await expect(
        evaluateBookingPricing(aquaThrillServiceId, {
          packageId: "pkg-inactive",
        })
      ).rejects.toThrow("Selected package is currently inactive");
    });

    it("rejects invalid departure session (timeSlotId)", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      await expect(
        evaluateBookingPricing(aquaThrillServiceId, {
          packageId: "pkg-1h-12ft",
          timeSlotId: "unknown-slot",
        })
      ).rejects.toThrow("Selected departure session does not belong to this service");
    });

    it("rejects inactive departure session", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      await expect(
        evaluateBookingPricing(aquaThrillServiceId, {
          packageId: "pkg-1h-12ft",
          timeSlotId: "slot-inactive",
        })
      ).rejects.toThrow("Selected departure session is inactive");
    });

    it("correctly applies active pickup zone surcharge", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      const result = await evaluateBookingPricing(aquaThrillServiceId, {
        packageId: "pkg-1h-12ft",
        pickupZoneId: "zone-rawai", // +500 THB surcharge
        adults: 2,
      });

      // Subtotal = 3,500 + 500 = 4,000 THB
      // 7% VAT on 4,000 = 280 THB
      // Total = 4,280 THB
      expect(result.packagePriceSnapshot).toBe(3500.00);
      expect(result.pickupSurcharge).toBe(500.00);
      expect(result.taxAmount).toBe(280.00);
      expect(result.finalPrice).toBe(4280.00);
    });

    it("rejects inactive pickup zone", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      await expect(
        evaluateBookingPricing(aquaThrillServiceId, {
          packageId: "pkg-1h-12ft",
          pickupZoneId: "zone-inactive",
        })
      ).rejects.toThrow("Selected pickup zone is inactive");
    });
  });

  describe("4. End-to-End Booking Creation & Snapshot Storage", () => {
    it("creates a customer booking with immutable package and net price snapshots", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      const res = await createBooking(
        {
          customerId: "cust-1",
          serviceId: aquaThrillServiceId,
          packageId: "pkg-1h-12ft",
          timeSlotId: "slot-morning",
          pickupZoneId: "zone-rawai",
          pickupLocation: "The Shore at Katathani",
          adults: 2,
        },
        false,
        "cust-1"
      );

      expect(bookingRepository.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: aquaThrillServiceId,
          packageId: "pkg-1h-12ft",
          timeSlotId: "slot-morning",
          pickupZoneId: "zone-rawai",
          departureTime: "09:00",
          pickupLocation: "The Shore at Katathani",
          packagePriceSnapshot: 3500.00,
          netPriceSnapshot: 2800.00,
          pickupSurcharge: 500.00,
          taxAmount: 280.00,
          finalPrice: 4280.00,
          currency: "THB",
        })
      );
      expect(res.id).toBe("booking-123");
    });

    it("creates an anonymous guest booking preserving package snapshots", async () => {
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockAquaThrillService as any);

      const guestRes = await createGuestBooking({
        customer: {
          name: "Guest Traveler",
          email: "guest@example.com",
          phone: "+66812345678",
        },
        serviceId: aquaThrillServiceId,
        packageId: "pkg-4h-17ft",
        adults: 4,
        children: 2,
        notes: "Need vegetarian meals",
      });

      expect(guestRes.booking).toBeDefined();
      expect(bookingRepository.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          packageId: "pkg-4h-17ft",
          packagePriceSnapshot: 11900.00,
          netPriceSnapshot: 8500.00,
          isGuest: true,
        }),
        expect.anything()
      );
    });
  });
});
