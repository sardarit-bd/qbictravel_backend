import { describe, it, expect, vi, beforeEach } from "vitest";
import { maskAccountNumber, affiliateService } from "../../affiliateService.js";
import AppError from "../../../../shared/utils/AppError.js";
import { prisma } from "../../../../lib/prisma.js";
import { affiliateNotification } from "../../affiliateNotification.js";

vi.mock("../../../../lib/prisma.js", () => {
  const mockTx = {
    $queryRaw: vi.fn(),
    affiliate: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    affiliatePayout: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    affiliateAuditEvent: {
      create: vi.fn(),
    },
    affiliateCommission: {
      aggregate: vi.fn(),
    },
  };

  return {
    prisma: {
      ...mockTx,
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
    },
  };
});

vi.mock("../../affiliateNotification.js", () => ({
  affiliateNotification: {
    notifyPayoutRequested: vi.fn(),
    notifyPayoutApproved: vi.fn(),
    notifyPayoutRejected: vi.fn(),
    notifyPayoutPaid: vi.fn(),
  },
}));

vi.mock("../../affiliateCommissionService.js", () => ({
  getOrCreateAffiliateSettings: vi.fn().mockResolvedValue({
    id: "default",
    globalCommissionRate: 10,
    attributionWindowDays: 30,
    minimumPayoutAmount: 50,
    eligibleAmountPolicy: "NET_AFTER_DISCOUNTS",
    isProgramActive: true,
  }),
}));

describe("Affiliate Bank Details & Manual Payout — End-to-End & Safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Bank Details Masking & Profile Updates", () => {
    it("maskAccountNumber correctly masks account numbers", () => {
      expect(maskAccountNumber("1234567890")).toBe("•••• •••• •••• 7890");
      expect(maskAccountNumber("987654321")).toBe("•••• •••• •••• 4321");
      expect(maskAccountNumber("1234")).toBe("1234");
      expect(maskAccountNumber("")).toBe("");
      expect(maskAccountNumber(null)).toBe("");
    });

    it("getMyProfile returns masked account number for safe viewing", async () => {
      vi.mocked(prisma.affiliate.findUnique).mockResolvedValue({
        id: "aff-1",
        userId: "user-1",
        code: "TEST1",
        status: "APPROVED",
        payoutMethod: "Bank Transfer",
        payoutDetails: {
          bankDetails: {
            bankName: "Kasikornbank",
            accountHolderName: "Somchai",
            accountNumber: "1234567890",
          },
        },
        commissionRateOverride: null,
        user: { id: "user-1", name: "Somchai", email: "somchai@example.com", role: "customer" },
      } as any);

      const profile = await affiliateService.getMyProfile("user-1");
      expect(profile).not.toBeNull();
      const bankDetails = (profile?.payoutDetails as any)?.bankDetails;
      expect(bankDetails.accountNumberMasked).toBe("•••• •••• •••• 7890");
      expect(bankDetails.bankName).toBe("Kasikornbank");
    });
  });

  describe("2. Payout Request Pre-conditions & Snapshot Immutability", () => {
    it("rejects payout request if affiliate has no bank details configured", async () => {
      vi.spyOn(affiliateService, "requireApprovedAffiliate").mockResolvedValue({
        id: "aff-1",
        userId: "user-1",
        code: "TEST1",
        status: "APPROVED",
        payoutDetails: null,
        user: { name: "Somchai", email: "somchai@example.com", role: "customer" },
      } as any);

      await expect(
        affiliateService.requestPayout("user-1", { amount: 100 })
      ).rejects.toThrow("Please provide and save your bank details");
    });

    it("rejects payout request if amount is below minimum payout threshold", async () => {
      vi.spyOn(affiliateService, "requireApprovedAffiliate").mockResolvedValue({
        id: "aff-1",
        userId: "user-1",
        code: "TEST1",
        status: "APPROVED",
        payoutDetails: {
          bankDetails: {
            bankName: "Kasikornbank",
            accountHolderName: "Somchai",
            accountNumber: "1234567890",
          },
        },
        user: { name: "Somchai", email: "somchai@example.com", role: "customer" },
      } as any);

      await expect(
        affiliateService.requestPayout("user-1", { amount: 20 })
      ).rejects.toThrow("Minimum payout amount is 50.00");
    });

    it("snapshots bank details at time of request, remaining immutable even if affiliate edits bank details later", async () => {
      const originalBank = {
        bankName: "Kasikornbank",
        accountHolderName: "Somchai Original",
        accountNumber: "1111222233",
        branchName: "Phuket Town",
      };

      vi.spyOn(affiliateService, "requireApprovedAffiliate").mockResolvedValue({
        id: "aff-1",
        userId: "user-1",
        code: "TEST1",
        status: "APPROVED",
        payoutDetails: { bankDetails: originalBank },
        user: { name: "Somchai", email: "somchai@example.com", role: "customer" },
      } as any);

      // Mock balances: Available 1000
      (prisma.affiliateCommission.aggregate as any).mockResolvedValue({ _sum: { amount: "1000" } });
      (prisma.affiliatePayout.aggregate as any).mockResolvedValue({ _sum: { amount: "0" } });

      const mockCreatedPayout = {
        id: "payout-xyz",
        affiliateId: "aff-1",
        amount: 200,
        currency: "THB",
        status: "PENDING",
        payoutMethod: "Bank Transfer",
        payoutDetailsSnapshot: { bankDetails: originalBank },
      };
      (prisma.affiliatePayout.create as any).mockResolvedValue(mockCreatedPayout);

      const payout = await affiliateService.requestPayout("user-1", { amount: 200 });

      expect(payout.payoutDetailsSnapshot).toEqual({ bankDetails: originalBank });
      expect(prisma.affiliatePayout.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payoutDetailsSnapshot: expect.objectContaining({
              bankDetails: expect.objectContaining({
                accountNumber: "1111222233",
                accountHolderName: "Somchai Original",
              }),
            }),
          }),
        })
      );

      // Notification sent
      expect(affiliateNotification.notifyPayoutRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          affiliateEmail: "somchai@example.com",
          amount: 200,
          payoutId: "payout-xyz",
        })
      );
    });
  });

  describe("3. Financial Safety & State Transitions", () => {
    it("rejects payout request if amount exceeds available balance", async () => {
      vi.spyOn(affiliateService, "requireApprovedAffiliate").mockResolvedValue({
        id: "aff-1",
        userId: "user-1",
        code: "TEST1",
        status: "APPROVED",
        payoutDetails: {
          bankDetails: {
            bankName: "Kasikornbank",
            accountHolderName: "Somchai",
            accountNumber: "1234567890",
          },
        },
        user: { name: "Somchai", email: "somchai@example.com", role: "customer" },
      } as any);

      // Available sum 100, Reserved payouts 80 -> Available balance = 20
      (prisma.affiliateCommission.aggregate as any).mockResolvedValue({ _sum: { amount: "100" } });
      (prisma.affiliatePayout.aggregate as any).mockResolvedValue({ _sum: { amount: "80" } });

      await expect(
        affiliateService.requestPayout("user-1", { amount: 80 })
      ).rejects.toThrow("Requested amount exceeds available balance");
    });

    it("approvePayout transitions PENDING to APPROVED and notifies affiliate", async () => {
      const mockPayout = {
        id: "payout-1",
        affiliateId: "aff-1",
        amount: 200,
        currency: "THB",
        status: "PENDING",
        affiliate: { user: { name: "Somchai", email: "somchai@example.com" } },
      };
      (prisma.affiliatePayout.findUnique as any).mockResolvedValue(mockPayout);
      (prisma.affiliatePayout.update as any).mockResolvedValue({ ...mockPayout, status: "APPROVED" });

      const res = await affiliateService.approvePayout("payout-1", "admin-1");
      expect(res.status).toBe("APPROVED");
      expect(affiliateNotification.notifyPayoutApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "somchai@example.com",
          amount: 200,
          payoutId: "payout-1",
        })
      );
    });

    it("prevents approving an already approved or non-pending payout", async () => {
      (prisma.affiliatePayout.findUnique as any).mockResolvedValue({
        id: "payout-1",
        status: "APPROVED",
        affiliate: { user: { name: "Somchai", email: "somchai@example.com" } },
      });

      await expect(
        affiliateService.approvePayout("payout-1", "admin-1")
      ).rejects.toThrow("Cannot approve payout in status APPROVED");
    });

    it("rejectPayout records mandatory reason and notifies affiliate", async () => {
      const mockPayout = {
        id: "payout-1",
        affiliateId: "aff-1",
        amount: 200,
        currency: "THB",
        status: "PENDING",
        affiliate: { user: { name: "Somchai", email: "somchai@example.com" } },
      };
      (prisma.affiliatePayout.findUnique as any).mockResolvedValue(mockPayout);
      (prisma.affiliatePayout.update as any).mockResolvedValue({
        ...mockPayout,
        status: "REJECTED",
        rejectionReason: "Name mismatch with bank account",
      });

      const res = await affiliateService.rejectPayout(
        "payout-1",
        "admin-1",
        "Name mismatch with bank account"
      );
      expect(res.status).toBe("REJECTED");
      expect(affiliateNotification.notifyPayoutRejected).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "somchai@example.com",
          reason: "Name mismatch with bank account",
        })
      );
    });

    it("prevents marking an unapproved (PENDING) payout as PAID", async () => {
      (prisma.affiliatePayout.findUnique as any).mockResolvedValue({
        id: "payout-1",
        status: "PENDING",
        affiliate: { user: { name: "Somchai", email: "somchai@example.com" } },
      });

      await expect(
        affiliateService.markPayoutPaid("payout-1", "admin-1", {
          transactionReference: "TXN-12345",
        })
      ).rejects.toThrow("Payout must be approved before being marked as paid");
    });

    it("prevents marking a REJECTED payout as PAID", async () => {
      (prisma.affiliatePayout.findUnique as any).mockResolvedValue({
        id: "payout-1",
        status: "REJECTED",
        affiliate: { user: { name: "Somchai", email: "somchai@example.com" } },
      });

      await expect(
        affiliateService.markPayoutPaid("payout-1", "admin-1", {
          transactionReference: "TXN-12345",
        })
      ).rejects.toThrow("Cannot mark a rejected payout as paid");
    });

    it("prevents marking an already PAID payout as PAID again", async () => {
      (prisma.affiliatePayout.findUnique as any).mockResolvedValue({
        id: "payout-1",
        status: "PAID",
        affiliate: { user: { name: "Somchai", email: "somchai@example.com" } },
      });

      await expect(
        affiliateService.markPayoutPaid("payout-1", "admin-1", {
          transactionReference: "TXN-12345",
        })
      ).rejects.toThrow("Payout has already been marked as paid");
    });

    it("successfully marks APPROVED payout as PAID, recording reference & notifying affiliate", async () => {
      const mockApproved = {
        id: "payout-1",
        affiliateId: "aff-1",
        amount: 500,
        currency: "THB",
        status: "APPROVED",
        payoutMethod: "Bank Transfer",
        affiliate: { user: { name: "Somchai", email: "somchai@example.com" } },
      };
      (prisma.affiliatePayout.findUnique as any).mockResolvedValue(mockApproved);
      (prisma.affiliatePayout.update as any).mockResolvedValue({
        ...mockApproved,
        status: "PAID",
        transactionReference: "KBANK-TRANSFER-998877",
        paidAt: new Date("2026-11-25T12:00:00Z"),
      });

      const res = await affiliateService.markPayoutPaid("payout-1", "admin-1", {
        transactionReference: "KBANK-TRANSFER-998877",
        paidAt: "2026-11-25T12:00:00Z",
      });

      expect(res.status).toBe("PAID");
      expect(prisma.affiliatePayout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PAID",
            transactionReference: "KBANK-TRANSFER-998877",
            processedById: "admin-1",
          }),
        })
      );
      expect(affiliateNotification.notifyPayoutPaid).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "somchai@example.com",
          amount: 500,
          reference: "KBANK-TRANSFER-998877",
          method: "Bank Transfer",
        })
      );
    });
  });
});
