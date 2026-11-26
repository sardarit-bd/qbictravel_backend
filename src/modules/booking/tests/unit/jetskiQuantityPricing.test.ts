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

describe("evaluateBookingPricing - Jet Ski Multiple Quantity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockJetskiService = {
    id: "svc-jetski-1",
    name: "Jet Ski Island Safari",
    pricingType: "PER_PACKAGE",
    isActive: true,
    pricing: [],
    timeSlots: [],
    pickupZones: [],
    packages: [
      {
        id: "pkg-seadoo-1630",
        name: "Sea-Doo 1630 High Performance Safari",
        sellingPrice: 6900,
        netPrice: 5000,
        currency: "THB",
        minPax: 1,
        maxCapacity: 2,
        isActive: true,
      },
    ],
  };

  it("calculates 5 Jet Skis x THB 6,900 = THB 34,500 with 4 independent riders", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockJetskiService as any);

    const result = await evaluateBookingPricing("svc-jetski-1", {
      packageId: "pkg-seadoo-1630",
      packageQuantity: 5,
      adults: 4,
      children: 0,
      infants: 0,
    });

    expect(result.basePrice).toBe(34500);
    expect(result.finalPrice).toBe(34500);
    expect(result.packageQuantity).toBe(5);
    expect(result.packagePriceSnapshot).toBe(6900);
    expect(result.netPriceSnapshot).toBe(25000);
    expect(result.currency).toBe("THB");
  });

  it("rejects rider count exceeding maxCapacity * packageQuantity (11 riders on 5 skis)", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockJetskiService as any);

    await expect(
      evaluateBookingPricing("svc-jetski-1", {
        packageId: "pkg-seadoo-1630",
        packageQuantity: 5,
        adults: 11,
      })
    ).rejects.toThrow(/maximum of 10 passengers/i);
  });

  it("defaults packageQuantity to 1 when omitted", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce(mockJetskiService as any);

    const result = await evaluateBookingPricing("svc-jetski-1", {
      packageId: "pkg-seadoo-1630",
      adults: 2,
    });

    expect(result.basePrice).toBe(6900);
    expect(result.finalPrice).toBe(6900);
    expect(result.packageQuantity).toBe(1);
  });

  it("does not multiply PER_PERSON pricing (Sirey Elephants) by packageQuantity", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce({
      id: "svc-elephant-1",
      name: "Sirey Elephants Sanctuary",
      pricingType: "PER_PERSON",
      isActive: true,
      pricing: [],
      timeSlots: [],
      pickupZones: [],
      packages: [
        {
          id: "pkg-prog-1",
          name: "Program 1 - Feed and Care",
          sellingPrice: 1500,
          netPrice: 1000,
          currency: "THB",
          minPax: 1,
          maxCapacity: 20,
          isActive: true,
        },
      ],
    } as any);

    const result = await evaluateBookingPricing("svc-elephant-1", {
      packageId: "pkg-prog-1",
      packageQuantity: 5,
      adults: 2,
      children: 1,
      infants: 0,
    });

    // 2 * 1500 + 1 * 900 = 3900 (NOT multiplied by 5)
    expect(result.basePrice).toBe(3900);
    expect(result.packageQuantity).toBe(1);
  });
});
