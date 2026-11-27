import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import { evaluateBookingPricing } from "../../bookingService.js";

vi.mock("../../../../lib/prisma.js", () => ({
  prisma: {
    service: {
      findUnique: vi.fn(),
    },
  },
}));

describe("evaluateBookingPricing - ATV & Buggy Flexible Admin Pricing & Transfer Rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAtvService = {
    id: "svc-atv-1",
    name: "ATV Phuket — ATV 1 Hour Tour",
    pricingType: "PER_PACKAGE",
    isActive: true,
    pricing: [],
    timeSlots: [
      { id: "slot-1", name: "Patong 08:30", departureTime: "08:30", isActive: true },
    ],
    pickupZones: [
      {
        id: "zone-patong",
        zoneName: "Patong",
        surchargeAmount: 0,
        surchargeUnit: "PER_BOOKING",
        hasPrivateTransfer: false,
        isActive: true,
      },
      {
        id: "zone-kamala-pod",
        zoneName: "Kamala",
        surchargeAmount: 1500,
        surchargeUnit: "PER_VEHICLE",
        hasPrivateTransfer: false,
        isActive: true,
      },
    ],
    metadata: {
      editorType: "ATV",
      packagePricingConfigs: [
        {
          packageId: "pkg-atv-1h",
          name: "ATV 1 Hour Tour",
          pricingMode: "RIDER_PASSENGER_CHILD",
          minVehicles: 1,
          maxVehicles: 10,
          riderPrice: 1800,
          passengerPrice: 1300,
          childPrice: 1300,
          childAgeRange: "4-11",
        },
      ],
      zoneConfigs: [
        {
          zoneId: "zone-kamala-pod",
          zoneName: "Kamala",
          payableOnDay: true,
        },
      ],
    },
    packages: [
      {
        id: "pkg-atv-1h",
        name: "ATV 1 Hour Tour",
        sellingPrice: 1800,
        netPrice: 1200,
        currency: "THB",
        minPax: 1,
        maxCapacity: 2,
        isActive: true,
      },
    ],
  };

  const mockBuggyService = {
    id: "svc-buggy-1",
    name: "Buggy Phuket — Buggy 60 Minutes (600cc)",
    pricingType: "PER_PACKAGE",
    isActive: true,
    pricing: [],
    timeSlots: [],
    pickupZones: [
      {
        id: "zone-town",
        zoneName: "Phuket Town",
        surchargeAmount: 300,
        surchargeUnit: "PER_PERSON",
        hasPrivateTransfer: false,
        isActive: true,
      },
    ],
    metadata: {
      editorType: "BUGGY",
      packagePricingConfigs: [
        {
          packageId: "pkg-buggy-600cc",
          name: "600cc Buggy 60 Minutes",
          pricingMode: "PER_VEHICLE",
          minVehicles: 1,
          maxVehicles: 8,
        },
      ],
      zoneConfigs: [
        {
          zoneId: "zone-town",
          zoneName: "Phuket Town",
          minPax: 2,
          payableOnDay: false,
        },
      ],
    },
    packages: [
      {
        id: "pkg-buggy-600cc",
        name: "600cc Buggy 60 Minutes",
        sellingPrice: 1900,
        netPrice: 1400,
        currency: "THB",
        minPax: 1,
        maxCapacity: 2,
        isActive: true,
      },
    ],
  };

  it("calculates ATV RIDER_PASSENGER_CHILD pricing (2 ATVs, 2 riders + 1 passenger + 1 child)", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockAtvService as any);

    const result = await evaluateBookingPricing("svc-atv-1", {
      packageId: "pkg-atv-1h",
      packageQuantity: 2,
      adults: 3, // 2 riders + 1 passenger
      children: 1,
      pickupZoneId: "zone-patong",
    });

    // 2 * 1800 + 1 * 1300 + 1 * 1300 = 6200
    expect(result.basePrice).toBe(6200);
    expect(result.finalPrice).toBe(6200);
    expect(result.packageQuantity).toBe(2);
    expect(result.pickupSurcharge).toBe(0);
    expect(result.payableOnDayTransferCharge).toBe(0);
  });

  it("excludes Payable-on-the-Day transfer surcharge from online total", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockAtvService as any);

    const result = await evaluateBookingPricing("svc-atv-1", {
      packageId: "pkg-atv-1h",
      packageQuantity: 1,
      adults: 1,
      children: 0,
      pickupZoneId: "zone-kamala-pod",
    });

    expect(result.basePrice).toBe(1800);
    expect(result.finalPrice).toBe(1800);
    expect(result.pickupSurcharge).toBe(0);
    expect(result.payableOnDayTransferCharge).toBe(1500);
  });

  it("calculates Buggy PER_VEHICLE pricing with Admin-configured minPax=2 online transfer surcharge", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockBuggyService as any);

    const result = await evaluateBookingPricing("svc-buggy-1", {
      packageId: "pkg-buggy-600cc",
      packageQuantity: 2,
      adults: 1, // below minPax 2 for Phuket Town -> charges 2 * 300 = 600
      pickupZoneId: "zone-town",
    });

    // 2 * 1900 = 3800 + 600 transfer = 4400
    expect(result.basePrice).toBe(4400);
    expect(result.finalPrice).toBe(4400);
    expect(result.pickupSurcharge).toBe(600);
    expect(result.payableOnDayTransferCharge).toBe(0);
    expect(result.packageQuantity).toBe(2);
  });

  it("rejects vehicle quantity exceeding Admin-configured maxVehicles", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockBuggyService as any);

    await expect(
      evaluateBookingPricing("svc-buggy-1", {
        packageId: "pkg-buggy-600cc",
        packageQuantity: 9,
        adults: 2,
      })
    ).rejects.toThrow(/between 1 and 8 vehicles/i);
  });

  it("rejects total passengers exceeding maxCapacity * packageQuantity", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockAtvService as any);

    await expect(
      evaluateBookingPricing("svc-atv-1", {
        packageId: "pkg-atv-1h",
        packageQuantity: 2,
        adults: 4,
        children: 1, // 5 pax > 2 * 2 = 4
      })
    ).rejects.toThrow(/maximum of 4 passengers/i);
  });
});
