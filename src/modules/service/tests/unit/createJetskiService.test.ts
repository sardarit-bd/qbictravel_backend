import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServiceRecord } from "../../serviceRepository.js";
import { prisma } from "../../../../lib/prisma.js";

vi.mock("../../../../lib/prisma.js", () => {
  const tx = {
    service: { create: vi.fn() },
    servicePricing: { create: vi.fn() },
    serviceAvailability: { upsert: vi.fn() },
    servicePackage: { create: vi.fn() },
    serviceTimeSlot: { create: vi.fn() },
    pickupZone: { create: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (cb: any) => cb(tx)),
      __tx: tx,
    },
  };
});

describe("createServiceRecord — Jet Ski Package Creation Hardening", () => {
  const tx = (prisma as any).__tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx.service.create.mockResolvedValue({
      id: "svc-jetski-7-islands",
      name: "7 Islands Jet Ski Tour Phuket",
      providerName: "Sunrise Jetski Safari",
    });
  });

  it("creates a Jet Ski service safely even with duplicate dates, empty numeric strings, and extra fields", async () => {
    const result = await createServiceRecord({
      name: "7 Islands Jet Ski Tour Phuket",
      description: "Guided 7 islands jet ski tour",
      type: "TOUR",
      status: "PUBLISHED",
      pricingType: "PER_PACKAGE",
      providerName: "Sunrise Jetski Safari",
      unexpectedExtraField: "should-be-stripped",
      metadata: { editorType: "JETSKI" },
      pricing: { currency: "THB", basePrice: 5900, discountedPrice: "" as any, taxRate: 7 },
      availability: [
        { date: "2026-12-01", isAvailable: true, capacity: 12 },
        { date: "2026-12-01", isAvailable: true, capacity: 12 },
      ],
      packages: [
        {
          name: "Yamaha 1100",
          durationMinutes: 180,
          maxCapacity: 2,
          sellingPrice: 5900,
          netPrice: "" as any,
          isActive: true,
        },
      ],
      timeSlots: [
        { name: "Morning", departureTime: "09:00", capacity: "" as any, isActive: true },
      ],
      pickupZones: [
        { zoneName: "Patong", surchargeAmount: 0, surchargeUnit: "PER_BOOKING", privateTransferCharge: "" as any },
      ],
    } as any);

    expect(result.id).toBe("svc-jetski-7-islands");
    expect(tx.service.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ unexpectedExtraField: expect.anything() }),
    });
    expect(tx.serviceAvailability.upsert).toHaveBeenCalledTimes(2);
    expect(tx.servicePackage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        netPrice: null,
        sellingPrice: 5900,
        durationMinutes: 180,
      }),
    });
    expect(tx.serviceTimeSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ capacity: null }),
    });
  });
});
