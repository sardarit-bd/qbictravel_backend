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
    staffDiscountRequest: {
      create: vi.fn(),
    },
    staffDiscountAuditEvent: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };

  return {
    prisma: {
      service: {
        findUnique: vi.fn(),
      },
      user: mockTx.user,
      serviceAvailability: mockTx.serviceAvailability,
      staffDiscountRequest: mockTx.staffDiscountRequest,
      staffDiscountAuditEvent: mockTx.staffDiscountAuditEvent,
      $transaction: vi.fn((callback) => callback(mockTx)),
      $queryRaw: mockTx.$queryRaw,
    },
  };
});

vi.mock("../../../notification/notificationService.js", () => ({
  notifyBookingCreated: vi.fn().mockResolvedValue(undefined),
  notifyBookingStatusChanged: vi.fn().mockResolvedValue(undefined),
}));

describe("Staff Booking Creation Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const staffId = "staff-uuid-1234";
  const customerId = "customer-uuid-5678";
  const serviceId = "service-uuid-9999";

  const mockService = {
    id: serviceId,
    name: "Phi Phi Island Day Trip",
    status: "PUBLISHED",
    metadata: {
      pricingTiers: [
        { tierName: "Adult", price: 100 },
        { tierName: "Child", price: 60 },
        { tierName: "Infant", price: 0 },
      ],
    },
    pricing: [
      {
        basePrice: 100,
        discountedPrice: 90,
        currency: "USD",
        validFrom: new Date("2020-01-01"),
        validTo: new Date("2030-01-01"),
      },
    ],
  };

  const mockActiveCustomer = {
    id: customerId,
    name: "John Traveler",
    email: "john@example.com",
    phone: "+66123456789",
    role: "customer",
    status: "active",
    deletedAt: null,
  };

  it("creates a staff booking for an existing valid customer with calculated standard price", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    (bookingRepository.createBooking as any).mockResolvedValue({
      id: "booking-uuid-1",
      customerId,
      agentId: null,
      createdById: staffId,
      source: "DIRECT",
      serviceId,
      availabilityId: null,
      currency: "USD",
      basePrice: 90,
      finalPrice: 90,
      status: "PENDING",
      paymentStatus: "UNPAID",
      requiresApproval: false,
    });

    const result = await bookingService.createStaffBooking(
      {
        customerId,
        serviceId,
        adults: 1,
      },
      staffId
    );

    expect(result.id).toBe("booking-uuid-1");
    expect(result.agentId).toBeNull();
    expect(result.source).toBe("DIRECT");
    expect(bookingRepository.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId,
        agentId: null,
        createdById: staffId,
        assignedStaffId: staffId,
        source: "DIRECT",
        basePrice: 90,
        finalPrice: 90,
        status: "CONFIRMED",
        requiresApproval: false,
        historyAction: "BOOKING_CREATED_BY_STAFF",
        actorRole: "staff",
      }),
      expect.anything()
    );
  });

  it("creates a guest customer account with randomized hash and associates booking without login email", async () => {
    // Email doesn't exist yet
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "new-cust-123",
      name: "New Guest",
      email: "newguest@example.com",
      phone: "+66987654321",
    } as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    (bookingRepository.createBooking as any).mockResolvedValue({
      id: "booking-uuid-2",
      customerId: "new-cust-123",
      agentId: null,
      createdById: staffId,
      source: "DIRECT",
      serviceId,
      currency: "USD",
      basePrice: 90,
      finalPrice: 90,
      status: "PENDING",
      requiresApproval: false,
    });

    const result = await bookingService.createStaffBooking(
      {
        customer: {
          name: "New Guest",
          email: "newguest@example.com",
          phone: "+66987654321",
        },
        serviceId,
        adults: 1,
      },
      staffId
    );

    expect(result.customerId).toBe("new-cust-123");
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "New Guest",
          email: "newguest@example.com",
          role: "customer",
          status: "active",
        }),
      })
    );
  });

  it("rejects booking if existing email belongs to a non-customer role (e.g. agent/staff)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "agent-user-id",
      role: "agent",
      status: "active",
      deletedAt: null,
    } as any);

    await expect(
      bookingService.createStaffBooking(
        {
          customer: {
            name: "Agent As Traveler",
            email: "agent@agency.com",
          },
          serviceId,
        },
        staffId
      )
    ).rejects.toThrow("This email belongs to a non-customer account");
  });

  it("rejects booking if customer account is inactive or deleted", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "inactive-customer",
      role: "customer",
      status: "inactive",
      deletedAt: new Date(),
    } as any);

    await expect(
      bookingService.createStaffBooking(
        {
          customerId: "inactive-customer",
          serviceId,
        },
        staffId
      )
    ).rejects.toThrow("This customer account is inactive");
  });

  it("calculates multi-passenger tiered pricing (Adult + Child + Infant) correctly", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    (bookingRepository.createBooking as any).mockResolvedValue({
      id: "booking-uuid-3",
      finalPrice: 240, // 2 adults * 90 (discounted base) + 1 child * 60 + 1 infant * 0 = 180 + 60 = 240
    });

    await bookingService.createStaffBooking(
      {
        customerId,
        serviceId,
        adults: 2,
        children: 1,
        infants: 1,
      },
      staffId
    );

    expect(bookingRepository.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        basePrice: 240,
        finalPrice: 240,
      }),
      expect.anything()
    );
  });

  it("rejects booking if tour is not published", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue({
      ...mockService,
      status: "DRAFT",
    } as any);

    await expect(
      bookingService.createStaffBooking(
        {
          customerId,
          serviceId,
        },
        staffId
      )
    ).rejects.toThrow("Cannot book unpublished tour");
  });

  it("checks availability capacity and rejects if insufficient capacity", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]); // Update matched 0 rows due to capacity
    vi.mocked(prisma.serviceAvailability.findUnique).mockResolvedValue({
      id: "avail-1",
      isAvailable: true,
      capacity: 10,
      bookedCount: 9, // only 1 spot left
    } as any);

    await expect(
      bookingService.createStaffBooking(
        {
          customerId,
          serviceId,
          travelDate: "2026-12-01",
          adults: 2, // requires 2 spots
        },
        staffId
      )
    ).rejects.toThrow("Selected date does not have sufficient capacity");
  });

  it("reserves capacity atomically and associates availabilityId when capacity is sufficient", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "avail-atomic-1" }]);
    (bookingRepository.createBooking as any).mockResolvedValue({
      id: "booking-avail-success",
      availabilityId: "avail-atomic-1",
      finalPrice: 90,
    });

    const result = await bookingService.createStaffBooking(
      {
        customerId,
        serviceId,
        travelDate: "2026-12-01",
        adults: 1,
      },
      staffId
    );

    expect(result.id).toBe("booking-avail-success");
    expect(bookingRepository.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        availabilityId: "avail-atomic-1",
      }),
      expect.anything()
    );
  });

  it("supports unlimited capacity (capacity = null) and increments successfully", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "avail-unlimited-1" }]);
    (bookingRepository.createBooking as any).mockResolvedValue({
      id: "booking-unlimited-success",
      availabilityId: "avail-unlimited-1",
      finalPrice: 90,
    });

    const result = await bookingService.createStaffBooking(
      {
        customerId,
        serviceId,
        travelDate: "2026-12-01",
        adults: 5,
      },
      staffId
    );

    expect(result.id).toBe("booking-unlimited-success");
    expect(bookingRepository.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        availabilityId: "avail-unlimited-1",
      }),
      expect.anything()
    );
  });

  it("rolls back transaction if booking persistence fails after customer resolution", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "cust-rollback" } as any);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
    (bookingRepository.createBooking as any).mockRejectedValue(new Error("Database write failure"));

    await expect(
      bookingService.createStaffBooking(
        {
          customer: {
            name: "Fail Traveler",
            email: "fail@example.com",
          },
          serviceId,
          adults: 1,
        },
        staffId
      )
    ).rejects.toThrow("Database write failure");
  });

  describe("Unified Staff Booking with Optional Discount Request", () => {
    it("creates booking directly in CONFIRMED status with approved StaffDiscountRequest and audit event when discount is applied", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);
      vi.mocked(prisma.staffDiscountRequest.create).mockResolvedValue({
        id: "discount-req-1",
        bookingId: "booking-discount-1",
        status: "APPROVED",
      } as any);
      vi.mocked(prisma.staffDiscountAuditEvent.create).mockResolvedValue({
        id: "audit-req-1",
      } as any);

      const notificationService = await import("../../../notification/notificationService.js");

      (bookingRepository.createBooking as any).mockResolvedValue({
        id: "booking-discount-1",
        customerId,
        agentId: null,
        createdById: staffId,
        assignedStaffId: staffId,
        source: "DIRECT",
        serviceId,
        currency: "USD",
        basePrice: 90,
        finalPrice: 81,
        status: "CONFIRMED",
        requiresApproval: false,
      });

      const result = await bookingService.createStaffBooking(
        {
          customerId,
          serviceId,
          travelDate: "2026-12-01",
          adults: 1,
          discount: {
            discountType: "PERCENTAGE",
            discountValue: 10,
            reason: "VIP Loyal Customer discount",
          },
        },
        staffId
      );

      expect(result.id).toBe("booking-discount-1");
      expect(result.status).toBe("CONFIRMED");
      expect(bookingRepository.createBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "CONFIRMED",
          requiresApproval: false,
          basePrice: 90,
          finalPrice: 81,
          assignedStaffId: staffId,
        }),
        expect.anything()
      );

      // Verify StaffDiscountRequest was created with APPROVED
      expect(prisma.staffDiscountRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bookingId: "booking-discount-1",
            discountType: "PERCENTAGE",
            discountValue: 10,
            originalPrice: 90,
            discountAmount: 9,
            proposedFinalPrice: 81,
            approvedDiscountAmount: 9,
            approvedFinalPrice: 81,
            status: "APPROVED",
            reason: "VIP Loyal Customer discount",
            requestedById: staffId,
          }),
        })
      );

      // Verify audit event DISCOUNT_APPROVED was logged
      expect(prisma.staffDiscountAuditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            discountRequestId: "discount-req-1",
            bookingId: "booking-discount-1",
            actorId: staffId,
            action: "DISCOUNT_APPROVED",
            newStatus: "APPROVED",
            originalPrice: 90,
            proposedFinalPrice: 81,
            finalPrice: 81,
          }),
        })
      );

      // Verify customer booking confirmation email WAS dispatched for confirmed booking
      expect(notificationService.notifyBookingCreated).toHaveBeenCalledWith("booking-discount-1");
    });

    it("rejects booking creation if percentage discount exceeds 100%", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);

      await expect(
        bookingService.createStaffBooking(
          {
            customerId,
            serviceId,
            travelDate: "2026-12-01",
            adults: 1,
            discount: {
              discountType: "PERCENTAGE",
              discountValue: 105,
              reason: "Invalid discount",
            },
          },
          staffId
        )
      ).rejects.toThrow("Percentage discount must be between 1 and 100");
    });

    it("rejects booking creation if fixed discount is equal to or greater than base price", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveCustomer as any);
      vi.mocked(prisma.service.findUnique).mockResolvedValue(mockService as any);

      await expect(
        bookingService.createStaffBooking(
          {
            customerId,
            serviceId,
            travelDate: "2026-12-01",
            adults: 1,
            discount: {
              discountType: "FIXED_AMOUNT",
              discountValue: 90,
              reason: "Free tour attempt",
            },
          },
          staffId
        )
      ).rejects.toThrow("strictly less than the standard original price");
    });
  });
});
