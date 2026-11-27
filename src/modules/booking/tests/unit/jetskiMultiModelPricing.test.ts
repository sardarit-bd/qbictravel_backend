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

describe("evaluateBookingPricing - Multi-Model Jet Ski Selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockJetskiService = {
    id: "svc-jetski-multi",
    name: "Phuket Coastal Jet Ski Safari",
    pricingType: "PER_PACKAGE",
    isActive: true,
    pricing: [],
    timeSlots: [{ id: "slot-am", name: "Morning", departureTime: "09:00", isActive: true }],
    pickupZones: [
      { id: "zone-patong", zoneName: "Patong", surchargeAmount: 500, surchargeUnit: "PER_BOOKING", isActive: true },
    ],
    packages: [
      { id: "pkg-yamaha-1100", name: "Yamaha 1100 Single/Double Cruiser", sellingPrice: 5900, netPrice: 4800, currency: "THB", minPax: 1, maxCapacity: 2, isActive: true },
      { id: "pkg-seadoo-1630", name: "Sea-Doo 1630 High Performance Safari", sellingPrice: 6900, netPrice: 5600, currency: "THB", minPax: 1, maxCapacity: 2, isActive: true },
      { id: "pkg-yamaha-1800", name: "Yamaha 1800 Supercharged Power Ski", sellingPrice: 8900, netPrice: 7200, currency: "THB", minPax: 1, maxCapacity: 2, isActive: true },
    ],
  };

  it("calculates 3 different Jet Ski models with independent quantities and riders in one booking", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockJetskiService as any);

    const result = await evaluateBookingPricing("svc-jetski-multi", {
      packageItems: [
        { packageId: "pkg-yamaha-1100", quantity: 2, riders: 3 },
        { packageId: "pkg-seadoo-1630", quantity: 1, riders: 2 },
        { packageId: "pkg-yamaha-1800", quantity: 1, riders: 1 },
      ],
      pickupZoneId: "zone-patong",
      adults: 6,
    });

    // 2*5900 (11800) + 1*6900 (6900) + 1*8900 (8900) = 27600 + 500 transfer = 28100
    expect(result.basePrice).toBe(28100);
    expect(result.finalPrice).toBe(28100);
    expect(result.pickupSurcharge).toBe(500);
    expect(result.packageQuantity).toBe(4);
    expect(result.packageItems).toHaveLength(3);
    expect(result.packageItems?.[0]).toMatchObject({
      packageId: "pkg-yamaha-1100",
      quantity: 2,
      riders: 3,
      unitPrice: 5900,
      subtotal: 11800,
    });
    expect(result.packageItems?.[1]).toMatchObject({
      packageId: "pkg-seadoo-1630",
      quantity: 1,
      riders: 2,
      unitPrice: 6900,
      subtotal: 6900,
    });
    expect(result.packageItems?.[2]).toMatchObject({
      packageId: "pkg-yamaha-1800",
      quantity: 1,
      riders: 1,
      unitPrice: 8900,
      subtotal: 8900,
    });
  });

  it("rejects per-model rider count exceeding that model's maxCapacity * quantity", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockJetskiService as any);

    await expect(
      evaluateBookingPricing("svc-jetski-multi", {
        packageItems: [
          { packageId: "pkg-yamaha-1100", quantity: 1, riders: 3 }, // max 2
          { packageId: "pkg-seadoo-1630", quantity: 1, riders: 1 },
        ],
      })
    ).rejects.toThrow(/Yamaha 1100.*maximum of 2 riders/i);
  });
});
