import { describe, it, expect, vi, beforeEach } from "vitest";
import * as discountService from "../../discountService.js";
import * as discountRepository from "../../discountRepository.js";
import { prisma } from "../../../../lib/prisma.js";
import AppError from "../../../../shared/utils/AppError.js";

vi.mock("../../../../lib/prisma.js", () => {
  const mockPrisma = {
    $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    booking: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    staffDiscountRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    staffDiscountAuditEvent: {
      create: vi.fn(),
    },
    paymentLink: {
      updateMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

describe("Staff Discount Service - Unit Tests", () => {
  const mockStaffUser = { id: "staff-1", role: "staff" };
  const mockAdminUser = { id: "admin-1", role: "admin" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createStaffDiscountRequest", () => {
    const validBooking = {
      id: "bkg-1",
      status: "PENDING",
      paymentStatus: "UNPAID",
      requiresApproval: false,
      currency: "THB",
      basePrice: 10000,
      finalPrice: 10000,
      createdById: "staff-1",
      assignedStaffId: null,
      agentId: null,
    };

    it("successfully creates a percentage discount request and logs audit event", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(validBooking as any);
      vi.mocked(prisma.staffDiscountRequest.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.staffDiscountRequest.create).mockResolvedValue({
        id: "req-1",
        bookingId: "bkg-1",
        discountType: "PERCENTAGE",
        discountValue: 10,
        originalPrice: 10000,
        discountAmount: 1000,
        proposedFinalPrice: 9000,
        approvedDiscountAmount: null,
        approvedFinalPrice: null,
        status: "PENDING",
        reason: "VIP repeat customer discount",
        rejectionReason: null,
        adminNotes: null,
        requestedById: "staff-1",
        reviewedById: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await discountService.createStaffDiscountRequest(
        "bkg-1",
        {
          discountType: "PERCENTAGE",
          discountValue: 10,
          reason: "VIP repeat customer discount",
        },
        mockStaffUser
      );

      expect(result.id).toBe("req-1");
      expect(result.discountAmount).toBe(1000);
      expect(result.proposedFinalPrice).toBe(9000);
      expect(result.status).toBe("PENDING");

      // Verify booking was updated to requiresApproval = true, finalPrice untouched
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: "bkg-1" },
        data: {
          requiresApproval: true,
          proposedPrice: 9000,
        },
      });

      // Verify existing active payment links were expired
      expect(prisma.paymentLink.updateMany).toHaveBeenCalledWith({
        where: {
          bookingId: "bkg-1",
          status: "ACTIVE",
        },
        data: {
          status: "EXPIRED",
        },
      });

      // Verify audit event snapshot created
      expect(prisma.staffDiscountAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discountRequestId: "req-1",
          bookingId: "bkg-1",
          actorId: "staff-1",
          actorRole: "staff",
          action: "DISCOUNT_REQUESTED",
          originalPrice: 10000,
          discountType: "PERCENTAGE",
          discountValue: 10,
          requestedDiscountAmount: 1000,
          proposedFinalPrice: 9000,
          finalPrice: 10000,
          reason: "VIP repeat customer discount",
        }),
      });
    });

    it("successfully creates a fixed amount discount request", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(validBooking as any);
      vi.mocked(prisma.staffDiscountRequest.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.staffDiscountRequest.create).mockResolvedValue({
        id: "req-2",
        bookingId: "bkg-1",
        discountType: "FIXED_AMOUNT",
        discountValue: 1500,
        originalPrice: 10000,
        discountAmount: 1500,
        proposedFinalPrice: 8500,
        approvedDiscountAmount: null,
        approvedFinalPrice: null,
        status: "PENDING",
        reason: "Fixed promotion coupon",
        rejectionReason: null,
        adminNotes: null,
        requestedById: "staff-1",
        reviewedById: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await discountService.createStaffDiscountRequest(
        "bkg-1",
        {
          discountType: "FIXED_AMOUNT",
          discountValue: 1500,
          reason: "Fixed promotion coupon",
        },
        mockStaffUser
      );

      expect(result.discountAmount).toBe(1500);
      expect(result.proposedFinalPrice).toBe(8500);
    });

    it("rejects unauthorized staff who is not creator or assigned staff", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue({
        ...validBooking,
        createdById: "staff-other",
        assignedStaffId: "staff-other",
      } as any);

      await expect(
        discountService.createStaffDiscountRequest(
          "bkg-1",
          {
            discountType: "PERCENTAGE",
            discountValue: 10,
            reason: "Discount",
          },
          mockStaffUser
        )
      ).rejects.toThrow("You are not authorized to request a discount for this booking");
    });

    it("rejects duplicate pending request for the same booking", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(validBooking as any);
      vi.mocked(prisma.staffDiscountRequest.findFirst).mockResolvedValue({
        id: "existing-pending-req",
        status: "PENDING",
      } as any);

      await expect(
        discountService.createStaffDiscountRequest(
          "bkg-1",
          {
            discountType: "PERCENTAGE",
            discountValue: 10,
            reason: "Discount",
          },
          mockStaffUser
        )
      ).rejects.toThrow("A pending discount request already exists for this booking");
    });

    it("rejects request if booking has already been paid", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue({
        ...validBooking,
        paymentStatus: "PAID",
      } as any);

      await expect(
        discountService.createStaffDiscountRequest(
          "bkg-1",
          {
            discountType: "PERCENTAGE",
            discountValue: 10,
            reason: "Discount",
          },
          mockStaffUser
        )
      ).rejects.toThrow("Cannot request discount for a booking that has already been paid");
    });

    it("rejects fixed discount exceeding original booking price", async () => {
      vi.mocked(prisma.booking.findUnique).mockResolvedValue(validBooking as any);
      vi.mocked(prisma.staffDiscountRequest.findFirst).mockResolvedValue(null);

      await expect(
        discountService.createStaffDiscountRequest(
          "bkg-1",
          {
            discountType: "FIXED_AMOUNT",
            discountValue: 12000,
            reason: "Excessive discount",
          },
          mockStaffUser
        )
      ).rejects.toThrow(/must be strictly less than original price/);
    });
  });

  describe("reviewStaffDiscountRequest", () => {
    const pendingRequest = {
      id: "req-1",
      bookingId: "bkg-1",
      discountType: "PERCENTAGE",
      discountValue: 10,
      originalPrice: 10000,
      discountAmount: 1000,
      proposedFinalPrice: 9000,
      approvedDiscountAmount: null,
      approvedFinalPrice: null,
      status: "PENDING",
      reason: "Loyalty rate",
      requestedById: "staff-1",
      booking: {
        id: "bkg-1",
        status: "PENDING",
        paymentStatus: "UNPAID",
        basePrice: 10000,
        finalPrice: 10000,
        currency: "THB",
      },
    };

    it("allows Admin full approval: updates Booking finalPrice and logs audit event", async () => {
      vi.mocked(prisma.staffDiscountRequest.findUnique).mockResolvedValue(pendingRequest as any);
      vi.mocked(prisma.staffDiscountRequest.update).mockResolvedValue({
        ...pendingRequest,
        status: "APPROVED",
        approvedDiscountAmount: 1000,
        approvedFinalPrice: 9000,
        reviewedById: "admin-1",
        reviewedAt: new Date(),
        adminNotes: "Approved VIP request",
      } as any);

      const result = await discountService.reviewStaffDiscountRequest(
        "req-1",
        { decision: "APPROVE", adminNotes: "Approved VIP request" },
        mockAdminUser
      );

      expect(result.status).toBe("APPROVED");
      expect(result.approvedFinalPrice).toBe(9000);

      // Verify authoritative Booking.finalPrice was updated to 9000
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: "bkg-1" },
        data: {
          finalPrice: 9000,
          requiresApproval: false,
        },
      });

      // Verify prior payment links revoked
      expect(prisma.paymentLink.updateMany).toHaveBeenCalledWith({
        where: { bookingId: "bkg-1", status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });

      // Verify audit event
      expect(prisma.staffDiscountAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discountRequestId: "req-1",
          bookingId: "bkg-1",
          action: "DISCOUNT_APPROVED",
          actorId: "admin-1",
          actorRole: "admin",
          previousStatus: "PENDING",
          newStatus: "APPROVED",
          approvedDiscountAmount: 1000,
          finalPrice: 9000,
        }),
      });
    });

    it("supports partial percentage approval lower than requested", async () => {
      vi.mocked(prisma.staffDiscountRequest.findUnique).mockResolvedValue(pendingRequest as any);
      vi.mocked(prisma.staffDiscountRequest.update).mockResolvedValue({
        ...pendingRequest,
        status: "APPROVED",
        approvedDiscountAmount: 500, // 5% approved instead of 10%
        approvedFinalPrice: 9500,
        reviewedById: "admin-1",
        reviewedAt: new Date(),
        adminNotes: "Approved lower rate: 5% maximum allowed",
      } as any);

      const result = await discountService.reviewStaffDiscountRequest(
        "req-1",
        {
          decision: "APPROVE",
          approvedDiscountValue: 5,
          adminNotes: "Approved lower rate: 5% maximum allowed",
        },
        mockAdminUser
      );

      expect(result.status).toBe("APPROVED");
      expect(result.approvedFinalPrice).toBe(9500);

      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: "bkg-1" },
        data: {
          finalPrice: 9500,
          requiresApproval: false,
        },
      });
    });

    it("rejects partial approval with discount value greater than requested", async () => {
      vi.mocked(prisma.staffDiscountRequest.findUnique).mockResolvedValue(pendingRequest as any);

      await expect(
        discountService.reviewStaffDiscountRequest(
          "req-1",
          {
            decision: "APPROVE",
            approvedDiscountValue: 15, // requested was 10
          },
          mockAdminUser
        )
      ).rejects.toThrow(/cannot exceed requested percentage/);
    });

    it("allows rejection with mandatory reason and preserves standard booking price", async () => {
      vi.mocked(prisma.staffDiscountRequest.findUnique).mockResolvedValue(pendingRequest as any);
      vi.mocked(prisma.staffDiscountRequest.update).mockResolvedValue({
        ...pendingRequest,
        status: "REJECTED",
        rejectionReason: "Outside seasonal campaign policy",
        reviewedById: "admin-1",
        reviewedAt: new Date(),
      } as any);

      const result = await discountService.reviewStaffDiscountRequest(
        "req-1",
        {
          decision: "REJECT",
          rejectionReason: "Outside seasonal campaign policy",
        },
        mockAdminUser
      );

      expect(result.status).toBe("REJECTED");

      // Verify booking was NOT cancelled; requiresApproval cleared and finalPrice stays original
      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: "bkg-1" },
        data: {
          requiresApproval: false,
        },
      });

      // Verify audit event
      expect(prisma.staffDiscountAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discountRequestId: "req-1",
          bookingId: "bkg-1",
          action: "DISCOUNT_REJECTED",
          actorId: "admin-1",
          previousStatus: "PENDING",
          newStatus: "REJECTED",
          rejectionReason: "Outside seasonal campaign policy",
          finalPrice: 10000,
        }),
      });
    });

    it("rejects rejection when mandatory reason is missing", async () => {
      vi.mocked(prisma.staffDiscountRequest.findUnique).mockResolvedValue(pendingRequest as any);

      await expect(
        discountService.reviewStaffDiscountRequest(
          "req-1",
          { decision: "REJECT", rejectionReason: "" },
          mockAdminUser
        )
      ).rejects.toThrow("A rejection reason is required when rejecting a discount request");
    });

    it("prevents self-approval when the reviewing admin is the requesting staff member", async () => {
      vi.mocked(prisma.staffDiscountRequest.findUnique).mockResolvedValue({
        ...pendingRequest,
        requestedById: "admin-1",
      } as any);

      await expect(
        discountService.reviewStaffDiscountRequest(
          "req-1",
          { decision: "APPROVE" },
          mockAdminUser
        )
      ).rejects.toThrow("Staff cannot approve or reject their own discount request");
    });

    it("rejects review if request has already been approved", async () => {
      vi.mocked(prisma.staffDiscountRequest.findUnique).mockResolvedValue({
        ...pendingRequest,
        status: "APPROVED",
      } as any);

      await expect(
        discountService.reviewStaffDiscountRequest(
          "req-1",
          { decision: "APPROVE" },
          mockAdminUser
        )
      ).rejects.toThrow("Discount request has already been approved");
    });

    it("rejects review from non-admin role", async () => {
      await expect(
        discountService.reviewStaffDiscountRequest(
          "req-1",
          { decision: "APPROVE" },
          mockStaffUser
        )
      ).rejects.toThrow("Only administrators can review discount requests");
    });
  });
});
