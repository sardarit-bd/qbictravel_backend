import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bookingService from "../../bookingService.js";
import * as bookingRepository from "../../bookingRepository.js";
import { prisma } from "../../../../lib/prisma.js";
import AppError from "../../../../shared/utils/AppError.js";

vi.mock("../../bookingRepository.js", () => ({
  createBooking: vi.fn(),
  findBookingById: vi.fn(),
  findActiveCustomer: vi.fn(),
}));

vi.mock("../../../../lib/prisma.js", () => {
  const mockTx: any = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    serviceAvailability: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    guestBookingSnapshot: {
      create: vi.fn(),
    },
    guestBookingToken: {
      create: vi.fn(),
    },
    paymentLink: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "avail-1", bookedCount: 2, capacity: 50 }]),
  };

  return {
    prisma: {
      service: {
        findUnique: vi.fn(),
      },
      user: mockTx.user,
      serviceAvailability: mockTx.serviceAvailability,
      guestBookingSnapshot: mockTx.guestBookingSnapshot,
      guestBookingToken: mockTx.guestBookingToken,
      paymentLink: mockTx.paymentLink,
      $transaction: vi.fn((callback) => callback(mockTx)),
      $executeRaw: mockTx.$executeRaw,
      $queryRaw: mockTx.$queryRaw,
    },
  };
});

vi.mock("../../../notification/notificationService.js", () => ({
  notifyBookingCreated: vi.fn().mockResolvedValue(undefined),
  notifyBookingStatusChanged: vi.fn().mockResolvedValue(undefined),
}));

describe("Guest Booking Creation Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const serviceId = "service-guest-uuid-1111";

  const mockService = {
    id: serviceId,
    name: "James Bond Island Sunset Tour",
    status: "PUBLISHED",
    capacity: 50,
    metadata: {
      pricingTiers: [
        { tierName: "Adult", price: 120 },
        { tierName: "Child", price: 80 },
        { tierName: "Infant", price: 0 },
      ],
    },
    pricing: [
      {
        id: "pricing-guest-1",
        basePrice: 120,
        currency: "USD",
        discountedPrice: null,
        validFrom: new Date("2026-01-01"),
        validTo: new Date("2026-12-31"),
      },
    ],
  };

  it("creates a guest booking with shadow customer, snapshot, access token, and active payment link", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "shadow-cust-123",
      name: "Alice Walker",
      email: "alice@example.com",
      phone: "+66812345678",
      role: "customer",
      status: "active",
    } as any);

    vi.mocked(bookingRepository.createBooking).mockResolvedValue({
      id: "booking-guest-001",
      customerId: "shadow-cust-123",
      agentId: null,
      createdById: null,
      source: "DIRECT",
      serviceId,
      availabilityId: "avail-1",
      currency: "USD",
      basePrice: 200,
      proposedPrice: null,
      finalPrice: 200,
      status: "PENDING",
      requiresApproval: false,
      notes: "Travel Date: 2026-11-25 | Guests: 1 Adult, 1 Child",
      isGuest: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await bookingService.createGuestBooking({
      customer: {
        name: "Alice Walker",
        email: "alice@example.com",
        phone: "+66812345678",
      },
      serviceId,
      travelDate: "2026-11-25",
      adults: 1,
      children: 1,
      infants: 0,
    });

    expect(result.booking.id).toBe("booking-guest-001");
    expect(result.booking.finalPrice).toBe(200);
    expect(result.guestSnapshot.guestName).toBe("Alice Walker");
    expect(result.guestSnapshot.guestEmail).toBe("alice@example.com");
    expect(result.accessToken).toBeDefined();
    expect(typeof result.accessToken).toBe("string");
    expect(result.paymentLink.token).toBeDefined();
    expect(result.paymentLink.paymentUrl).toContain("/pay/");

    // Check createBooking invocation
    expect(bookingRepository.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "shadow-cust-123",
        createdById: null,
        agentId: null,
        source: "DIRECT",
        isGuest: true,
        finalPrice: 200,
      }),
      expect.anything()
    );
  });

  it("fails if service is not found or unpublished", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValue(null);

    await expect(
      bookingService.createGuestBooking({
        customer: { name: "Bob", email: "bob@example.com" },
        serviceId: "unknown-svc",
      })
    ).rejects.toThrow("Service not found");
  });

  it("calculates guest pricing accurately based on tiers", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "existing-shadow-999",
      name: "Existing Bob",
      email: "bob@example.com",
      phone: "+66899999999",
      role: "customer",
      status: "active",
      deletedAt: null,
    } as any);

    vi.mocked(bookingRepository.createBooking).mockResolvedValue({
      id: "booking-guest-002",
      customerId: "existing-shadow-999",
      finalPrice: 320, // 2 adults (240) + 1 child (80)
      status: "PENDING",
      isGuest: true,
    } as any);

    const result = await bookingService.createGuestBooking({
      customer: { name: "Existing Bob", email: "bob@example.com", phone: "+66899999999" },
      serviceId,
      travelDate: "2026-11-25",
      adults: 2,
      children: 1,
      infants: 1,
    });

    // 2 * 120 + 1 * 80 + 1 * 0 = 320
    expect(bookingRepository.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        basePrice: 320,
        finalPrice: 320,
        isGuest: true,
      }),
      expect.anything()
    );
  });
});
