import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateBookingPricing } from "../../bookingService.js";
import { prisma } from "../../../../lib/prisma.js";
import AppError from "../../../../shared/utils/AppError.js";

vi.mock("../../../../lib/prisma.js", () => {
  return {
    prisma: {
      service: {
        findUnique: vi.fn(),
      },
    },
  };
});

describe("Sirey Elephants Care Camp Contract Pricing & Transfer Rules", () => {
  const sireyElephantService: any = {
    id: "serv-sirey-elephants",
    name: "Phuket Siray Elephant Care Camp Experience",
    pricingType: "PER_PERSON",
    pricing: [
      {
        id: "pr-1",
        basePrice: 900,
        discountedPrice: null,
        currency: "THB",
        taxRate: 0,
        validFrom: new Date(2026, 0, 1),
        validTo: new Date(2028, 0, 1),
      },
    ],
    metadata: {
      editorType: "SIREY_ELEPHANTS",
      programs: [
        {
          id: "prog-1",
          name: "Program 1: Feed and Care",
          adultPrice: 900,
          childPrice: 900,
          netPriceAdult: 600,
          netPriceChild: 600,
          transferIncluded: false,
        },
        {
          id: "prog-2",
          name: "Program 2: Feed and Bathe at the Private Beach",
          adultPrice: 2900,
          childPrice: 2500,
          netPriceAdult: 1500,
          netPriceChild: 1200,
          transferIncluded: true,
        },
      ],
    },
    packages: [
      {
        id: "prog-1",
        name: "Program 1: Feed and Care",
        minPax: 1,
        maxCapacity: 20,
        sellingPrice: 900,
        netPrice: 600,
        currency: "THB",
        isActive: true,
      },
      {
        id: "prog-2",
        name: "Program 2: Feed and Bathe at the Private Beach",
        minPax: 1,
        maxCapacity: 20,
        sellingPrice: 2900,
        netPrice: 1500,
        currency: "THB",
        isActive: true,
      },
    ],
    timeSlots: [
      {
        id: "slot-prog1",
        name: "Program 1: Daily Continuous Care (09:00 - 17:00)",
        departureTime: "09:00 AM",
        isActive: true,
      },
      {
        id: "slot-prog2",
        name: "Program 2: Morning Beach Session (09:30 - 13:30)",
        departureTime: "09:30 AM",
        isActive: true,
      },
    ],
    pickupZones: [
      {
        id: "zone-direct",
        zoneName: "Direct Arrival (Koh Sirey Camp)",
        surchargeAmount: 0,
        surchargeUnit: "PER_PERSON",
        hasPrivateTransfer: false,
        isActive: true,
      },
      {
        id: "zone-central-free",
        zoneName: "Phuket Central Free Zones (Program 2)",
        surchargeAmount: 0,
        surchargeUnit: "PER_PERSON",
        hasPrivateTransfer: false,
        isActive: true,
      },
      {
        id: "zone-layan",
        zoneName: "Layan",
        surchargeAmount: 250,
        surchargeUnit: "PER_PERSON",
        hasPrivateTransfer: false,
        isActive: true,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.service.findUnique).mockResolvedValue(sireyElephantService);
  });

  it("calculates Program 1 rates correctly (900 Adult, 900 Child, 0 Infant)", async () => {
    const res = await evaluateBookingPricing("serv-sirey-elephants", {
      packageId: "prog-1",
      adults: 2,
      children: 1,
      infants: 1,
      timeSlotId: "slot-prog1",
      pickupZoneId: "zone-direct",
    });

    // 2 * 900 + 1 * 900 + 0 = 2700 THB
    expect(res.basePrice).toBe(2700);
    expect(res.finalPrice).toBe(2700);
    expect(res.pickupSurcharge).toBe(0);
    expect(res.currency).toBe("THB");
  });

  it("calculates Program 2 rates correctly (2,900 Adult, 2,500 Child, 0 Infant)", async () => {
    const res = await evaluateBookingPricing("serv-sirey-elephants", {
      packageId: "prog-2",
      adults: 2,
      children: 2,
      infants: 1,
      timeSlotId: "slot-prog2",
      pickupZoneId: "zone-central-free",
    });

    // 2 * 2900 + 2 * 2500 + 0 = 5800 + 5000 = 10,800 THB
    expect(res.basePrice).toBe(10800);
    expect(res.finalPrice).toBe(10800);
    expect(res.pickupSurcharge).toBe(0);
  });

  it("enforces minimum 2 pax surcharge rule for remote zones (e.g. Layan 250 THB/pax min 2)", async () => {
    // 1 passenger in Layan surcharge zone -> minimum 2 pax charged = 500 THB
    const res1Pax = await evaluateBookingPricing("serv-sirey-elephants", {
      packageId: "prog-2",
      adults: 1,
      children: 0,
      infants: 0,
      timeSlotId: "slot-prog2",
      pickupZoneId: "zone-layan",
    });

    expect(res1Pax.pickupSurcharge).toBe(500); // 250 * 2 min pax
    expect(res1Pax.finalPrice).toBe(2900 + 500);

    // 3 passengers in Layan surcharge zone -> 3 * 250 = 750 THB
    const res3Pax = await evaluateBookingPricing("serv-sirey-elephants", {
      packageId: "prog-2",
      adults: 2,
      children: 1,
      infants: 0,
      timeSlotId: "slot-prog2",
      pickupZoneId: "zone-layan",
    });

    expect(res3Pax.pickupSurcharge).toBe(750);
    expect(res3Pax.finalPrice).toBe(2 * 2900 + 1 * 2500 + 750);
  });
});
