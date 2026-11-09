import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import * as paymentRepository from "../../paymentRepository.js";
import AppError from "../../../../shared/utils/AppError.js";

describe("Payment Confirmation Lifecycle Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("verifyStripePaymentAtomically", () => {
    it("1. automatically confirms an eligible PENDING booking on full verified Stripe payment", async () => {
      const mockBooking = {
        id: "b-1",
        status: "PENDING",
        paymentStatus: "UNPAID",
        requiresApproval: false,
        finalPrice: 200,
        currency: "USD",
        serviceId: "s-1",
        service: { id: "s-1", name: "Phi Phi Island Luxury Day Tour" },
      };

      const mockPayment = {
        id: "p-1",
        bookingId: "b-1",
        customerId: "c-1",
        amount: 200,
        currency: "USD",
        status: "INITIATED",
        method: "STRIPE",
        booking: mockBooking,
      };

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          payment: {
            findUnique: vi.fn().mockResolvedValue(mockPayment),
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({ ...mockPayment, status: "VERIFIED" }),
          },
          booking: {
            update: vi.fn().mockResolvedValue({ ...mockBooking, paymentStatus: "PAID", status: "CONFIRMED" }),
          },
          bookingHistory: {
            create: vi.fn().mockResolvedValue({}),
          },
          outboxMessage: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(tx);
      });

      const res = await paymentRepository.verifyStripePaymentAtomically({
        paymentId: "p-1",
        bookingId: "b-1",
        amount: 200,
        currency: "USD",
        stripePaymentIntentId: "pi_123",
        stripeSessionId: "cs_123",
      });

      expect(res.payment.status).toBe("VERIFIED");
      expect(res.isDuplicateSuccess).toBe(false);
    });

    it("2. does not auto-confirm an AWAITING_APPROVAL agent booking", async () => {
      const mockBooking = {
        id: "b-2",
        status: "AWAITING_APPROVAL",
        paymentStatus: "UNPAID",
        requiresApproval: true,
        finalPrice: 150,
        currency: "USD",
        serviceId: "s-1",
        service: { id: "s-1", name: "Phi Phi Island Luxury Day Tour" },
      };

      const mockPayment = {
        id: "p-2",
        bookingId: "b-2",
        customerId: "c-1",
        amount: 150,
        currency: "USD",
        status: "INITIATED",
        method: "STRIPE",
        booking: mockBooking,
      };

      let bookingUpdateData: any = null;

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          payment: {
            findUnique: vi.fn().mockResolvedValue(mockPayment),
            findFirst: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue({ ...mockPayment, status: "VERIFIED" }),
          },
          booking: {
            update: vi.fn().mockImplementation(({ data }: any) => {
              bookingUpdateData = data;
              return { ...mockBooking, ...data };
            }),
          },
          bookingHistory: {
            create: vi.fn().mockResolvedValue({}),
          },
          outboxMessage: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(tx);
      });

      await paymentRepository.verifyStripePaymentAtomically({
        paymentId: "p-2",
        bookingId: "b-2",
        amount: 150,
        currency: "USD",
        stripePaymentIntentId: "pi_456",
        stripeSessionId: "cs_456",
      });

      expect(bookingUpdateData).toEqual({ paymentStatus: "PAID" });
      expect(bookingUpdateData.status).toBeUndefined();
    });

    it("3. rejects payment verification when amount does not match authoritative booking price", async () => {
      const mockBooking = {
        id: "b-3",
        status: "PENDING",
        paymentStatus: "UNPAID",
        requiresApproval: false,
        finalPrice: 200,
        currency: "USD",
        service: { id: "s-1", name: "Tour" },
      };

      const mockPayment = {
        id: "p-3",
        bookingId: "b-3",
        customerId: "c-1",
        amount: 200,
        currency: "USD",
        status: "INITIATED",
        booking: mockBooking,
      };

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          payment: {
            findUnique: vi.fn().mockResolvedValue(mockPayment),
            findFirst: vi.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        paymentRepository.verifyStripePaymentAtomically({
          paymentId: "p-3",
          bookingId: "b-3",
          amount: 100, // partial/mismatched amount
          currency: "USD",
        })
      ).rejects.toThrow("Amount mismatch");
    });

    it("4. rejects payment verification when currency does not match authoritative booking currency", async () => {
      const mockBooking = {
        id: "b-4",
        status: "PENDING",
        paymentStatus: "UNPAID",
        requiresApproval: false,
        finalPrice: 200,
        currency: "USD",
        service: { id: "s-1", name: "Tour" },
      };

      const mockPayment = {
        id: "p-4",
        bookingId: "b-4",
        customerId: "c-1",
        amount: 200,
        currency: "USD",
        status: "INITIATED",
        booking: mockBooking,
      };

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          payment: {
            findUnique: vi.fn().mockResolvedValue(mockPayment),
            findFirst: vi.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        paymentRepository.verifyStripePaymentAtomically({
          paymentId: "p-4",
          bookingId: "b-4",
          amount: 200,
          currency: "THB",
        })
      ).rejects.toThrow("Currency mismatch");
    });
  });

  describe("transitionPayment (Manual Admin Verification)", () => {
    it("5. confirms an eligible PENDING booking when Admin verifies a full manual bank transfer", async () => {
      const mockBooking = {
        id: "b-5",
        status: "PENDING",
        paymentStatus: "UNPAID",
        requiresApproval: false,
        finalPrice: 500,
      };

      let bookingUpdateData: any = null;

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          payment: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "p-5", status: "VERIFIED" }),
          },
          booking: {
            findUnique: vi.fn().mockResolvedValue(mockBooking),
            updateMany: vi.fn().mockImplementation(({ data }: any) => {
              bookingUpdateData = data;
              return { count: 1 };
            }),
          },
          bookingHistory: {
            create: vi.fn().mockResolvedValue({}),
          },
          commission: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      const res = await paymentRepository.transitionPayment({
        paymentId: "p-5",
        bookingId: "b-5",
        amount: 500,
        fromStatus: "SUBMITTED",
        toStatus: "VERIFIED",
        adminId: "admin-1",
        action: "PAYMENT_VERIFIED",
        changes: {},
      });

      expect(res).not.toBeNull();
      expect(bookingUpdateData).toEqual({
        paymentStatus: "PAID",
        status: "CONFIRMED",
      });
    });

    it("6. rejects manual payment verification if booking requires price approval", async () => {
      const mockBooking = {
        id: "b-6",
        status: "AWAITING_APPROVAL",
        paymentStatus: "UNPAID",
        requiresApproval: true,
        finalPrice: 500,
      };

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          payment: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          booking: {
            findUnique: vi.fn().mockResolvedValue(mockBooking),
          },
        };
        return callback(tx);
      });

      await expect(
        paymentRepository.transitionPayment({
          paymentId: "p-6",
          bookingId: "b-6",
          amount: 500,
          fromStatus: "SUBMITTED",
          toStatus: "VERIFIED",
          adminId: "admin-1",
          action: "PAYMENT_VERIFIED",
          changes: {},
        })
      ).rejects.toThrow("The booking can no longer accept this payment");
    });
  });
});
