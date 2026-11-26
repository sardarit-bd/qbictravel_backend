import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../shared/utils/AppError.js";
import {
  calculateAffiliateBalances,
  generateAffiliateCode,
  resolveEffectiveRate,
  toCents,
} from "./affiliateCalculator.js";
import {
  hashIp,
  type AffiliateAttributionPayload,
} from "./affiliateAttribution.js";
import { getOrCreateAffiliateSettings } from "./affiliateCommissionService.js";
import { affiliateNotification } from "./affiliateNotification.js";

type DbClient = Prisma.TransactionClient | typeof prisma;

const INELIGIBLE_ROLES = new Set(["agent", "staff", "admin"]);

function assertEligibleForAffiliate(role: string): void {
  if (INELIGIBLE_ROLES.has(role)) {
    throw new AppError(
      "Agent, Staff, and Admin accounts are not eligible for the Affiliate Program",
      403
    );
  }
}

async function generateUniqueCode(db: DbClient): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const candidate = generateAffiliateCode();
    const exists = await db.affiliate.findUnique({ where: { code: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new AppError("Failed to generate unique affiliate code", 500);
}

async function computeBalancesForAffiliate(db: DbClient, affiliateId: string) {
  const [availableAgg, pendingAgg, reservedPayoutsAgg, paidPayoutsAgg] = await Promise.all([
    db.affiliateCommission.aggregate({
      where: { affiliateId, status: { in: ["AVAILABLE", "PAID", "REVERSED"] } },
      _sum: { amount: true },
    }),
    db.affiliateCommission.aggregate({
      where: { affiliateId, status: "PENDING" },
      _sum: { amount: true },
    }),
    db.affiliatePayout.aggregate({
      where: { affiliateId, status: { in: ["PENDING", "APPROVED"] } },
      _sum: { amount: true },
    }),
    db.affiliatePayout.aggregate({
      where: { affiliateId, status: "PAID" },
      _sum: { amount: true },
    }),
  ]);

  return calculateAffiliateBalances({
    availableLedgerSum: availableAgg._sum.amount?.toString() ?? "0",
    pendingLedgerSum: pendingAgg._sum.amount?.toString() ?? "0",
    reservedPayoutsSum: reservedPayoutsAgg._sum.amount?.toString() ?? "0",
    paidPayoutsSum: paidPayoutsAgg._sum.amount?.toString() ?? "0",
  });
}

export function maskAccountNumber(acc: string | null | undefined): string {
  if (!acc) return "";
  const cleaned = acc.trim();
  if (cleaned.length <= 4) return cleaned;
  const last4 = cleaned.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

export const affiliateService = {
  // ─── PUBLIC TRACKING ────────────────────────────────────────────────────────

  async validateCode(code: string) {
    const normalized = code.trim().toUpperCase();
    const settings = await getOrCreateAffiliateSettings();
    if (!settings.isProgramActive) {
      return { valid: false, reason: "Affiliate program is inactive" };
    }
    const affiliate = await prisma.affiliate.findUnique({
      where: { code: normalized },
      select: { id: true, code: true, status: true },
    });
    if (!affiliate || affiliate.status !== "APPROVED") {
      return { valid: false, reason: "Invalid or inactive referral code" };
    }
    return { valid: true, code: affiliate.code, windowDays: settings.attributionWindowDays };
  },

  async trackClick(params: {
    code: string;
    landingUrl: string;
    referrer?: string | null;
    linkId?: string | null;
    ip?: string;
    userAgent?: string;
  }): Promise<{ valid: boolean; attribution?: AffiliateAttributionPayload }> {
    const normalized = params.code.trim().toUpperCase();
    const settings = await getOrCreateAffiliateSettings();
    if (!settings.isProgramActive) return { valid: false };

    const affiliate = await prisma.affiliate.findUnique({
      where: { code: normalized },
      select: { id: true, code: true, status: true },
    });
    if (!affiliate || affiliate.status !== "APPROVED") {
      return { valid: false };
    }

    const windowMs = settings.attributionWindowDays * 24 * 60 * 60 * 1000;
    const exp = Date.now() + windowMs;
    const visitorToken = crypto.randomBytes(16).toString("hex");

    let validLinkId: string | null = null;
    if (params.linkId) {
      const link = await prisma.affiliateLink.findFirst({
        where: { id: params.linkId, affiliateId: affiliate.id, isActive: true },
        select: { id: true },
      });
      if (link) validLinkId = link.id;
    } else if (params.landingUrl) {
      // Resolve link by destination URL path (e.g. /tours/uuid or /)
      const cleanPath = params.landingUrl.split("?")[0]?.trim() || "/";
      const matchedLink = await prisma.affiliateLink.findFirst({
        where: {
          affiliateId: affiliate.id,
          targetPath: cleanPath,
          isActive: true,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (matchedLink) {
        validLinkId = matchedLink.id;
      }
    }

    const click = await prisma.$transaction(async (tx) => {
      const created = await tx.affiliateClick.create({
        data: {
          affiliateId: affiliate.id,
          affiliateLinkId: validLinkId,
          referralCode: affiliate.code,
          visitorToken,
          landingUrl: params.landingUrl || "/",
          referrer: params.referrer ?? null,
          ipHash: hashIp(params.ip),
          userAgent: params.userAgent?.slice(0, 500) ?? null,
          expiresAt: new Date(exp),
        },
      });
      if (validLinkId) {
        await tx.affiliateLink.update({
          where: { id: validLinkId },
          data: { clickCount: { increment: 1 } },
        });
      }
      return created;
    });

    return {
      valid: true,
      attribution: {
        clickId: click.id,
        affiliateId: affiliate.id,
        code: affiliate.code,
        exp,
      },
    };
  },

  /**
   * Attach server-validated last-click attribution to a newly created customer booking.
   * Immutable once persisted; silently skips invalid/expired/suspended/self-referral cases.
   */
  async attachAttributionToBooking(
    tx: Prisma.TransactionClient,
    params: {
      bookingId: string;
      customerId: string;
      attributionPayload?: AffiliateAttributionPayload | null;
      fallbackCode?: string | null;
    }
  ) {
    const settings = await getOrCreateAffiliateSettings(tx);
    if (!settings.isProgramActive) return null;

    let affiliateId: string | null = null;
    let affiliateClickId: string | null = null;
    let referralCode: string | null = null;

    if (params.attributionPayload && params.attributionPayload.exp > Date.now()) {
      const aff = await tx.affiliate.findUnique({
        where: { id: params.attributionPayload.affiliateId },
        select: { id: true, userId: true, code: true, status: true },
      });
      if (aff && aff.status === "APPROVED" && aff.userId !== params.customerId) {
        affiliateId = aff.id;
        referralCode = aff.code;
        const click = await tx.affiliateClick.findUnique({
          where: { id: params.attributionPayload.clickId },
          select: { id: true, expiresAt: true },
        });
        if (click && click.expiresAt.getTime() > Date.now()) {
          affiliateClickId = click.id;
        }
      }
    } else if (params.fallbackCode) {
      const normalized = params.fallbackCode.trim().toUpperCase();
      const aff = await tx.affiliate.findUnique({
        where: { code: normalized },
        select: { id: true, userId: true, code: true, status: true },
      });
      if (aff && aff.status === "APPROVED" && aff.userId !== params.customerId) {
        affiliateId = aff.id;
        referralCode = aff.code;
      }
    }

    if (!affiliateId || !referralCode) return null;

    return tx.affiliateBookingAttribution.create({
      data: {
        bookingId: params.bookingId,
        affiliateId,
        affiliateClickId,
        referralCode,
        windowDays: settings.attributionWindowDays,
      },
    });
  },

  // ─── AFFILIATE PORTAL ───────────────────────────────────────────────────────

  async applyAsAffiliate(
    userId: string,
    input: {
      websiteUrl?: string | null;
      promotionChannels?: string | null;
      payoutMethod?: string | null;
      payoutDetails?: Record<string, unknown> | null;
    }
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, status: true },
    });
    if (!user || user.status !== "active") {
      throw new AppError("User account is not active", 403);
    }
    assertEligibleForAffiliate(user.role);

    const existing = await prisma.affiliate.findUnique({ where: { userId } });
    if (existing) {
      if (existing.status === "REJECTED") {
        // Allow re-application
        const updated = await prisma.affiliate.update({
          where: { id: existing.id },
          data: {
            status: "PENDING",
            rejectionReason: null,
            websiteUrl: input.websiteUrl ?? existing.websiteUrl,
            promotionChannels: input.promotionChannels ?? existing.promotionChannels,
            payoutMethod: input.payoutMethod ?? existing.payoutMethod,
            payoutDetails: (input.payoutDetails ?? existing.payoutDetails ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
        await prisma.affiliateAuditEvent.create({
          data: {
            affiliateId: updated.id,
            entityType: "AFFILIATE",
            entityId: updated.id,
            action: "AFFILIATE_REAPPLIED",
            actorId: userId,
          },
        });
        void affiliateNotification.notifyAdminNewApplication({
          applicantName: user.name,
          applicantEmail: user.email,
          code: updated.code,
        });
        return updated;
      }
      throw new AppError(`Affiliate profile already exists with status ${existing.status}`, 409);
    }

    const code = await generateUniqueCode(prisma);
    const created = await prisma.$transaction(async (tx) => {
      const affiliate = await tx.affiliate.create({
        data: {
          userId,
          code,
          status: "PENDING",
          websiteUrl: input.websiteUrl ?? null,
          promotionChannels: input.promotionChannels ?? null,
          payoutMethod: input.payoutMethod ?? null,
          payoutDetails: (input.payoutDetails ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: affiliate.id,
          entityType: "AFFILIATE",
          entityId: affiliate.id,
          action: "AFFILIATE_APPLIED",
          actorId: userId,
        },
      });
      return affiliate;
    });

    void affiliateNotification.notifyAdminNewApplication({
      applicantName: user.name,
      applicantEmail: user.email,
      code: created.code,
    });

    return created;
  },

  async getMyProfile(userId: string) {
    const affiliate = await prisma.affiliate.findUnique({
      where: { userId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    if (!affiliate) return null;
    const settings = await getOrCreateAffiliateSettings();
    const effectiveCommissionRate = resolveEffectiveRate(
      settings.globalCommissionRate.toString(),
      affiliate.commissionRateOverride?.toString() ?? null
    );

    const rawDetails = affiliate.payoutDetails as Record<string, any> | null;
    let maskedDetails = rawDetails;
    if (rawDetails && typeof rawDetails === "object") {
      maskedDetails = {
        ...rawDetails,
        bankDetails: rawDetails.bankDetails
          ? {
              ...rawDetails.bankDetails,
              accountNumberMasked: maskAccountNumber(rawDetails.bankDetails.accountNumber),
              accountNumber: rawDetails.bankDetails.accountNumber, // Allow affiliate themselves to view/edit
            }
          : undefined,
      };
    }

    return {
      ...affiliate,
      payoutDetails: maskedDetails,
      effectiveCommissionRate,
      minimumPayoutAmount: Number(settings.minimumPayoutAmount),
      attributionWindowDays: settings.attributionWindowDays,
    };
  },

  async updateMyProfile(
    userId: string,
    input: {
      websiteUrl?: string | null;
      promotionChannels?: string | null;
      payoutMethod?: string | null;
      payoutDetails?: Record<string, unknown> | null;
      bankDetails?: {
        bankName: string;
        accountHolderName: string;
        accountNumber: string;
        branchName?: string | null;
        swiftBic?: string | null;
        routingNumber?: string | null;
      } | null;
    }
  ) {
    const affiliate = await prisma.affiliate.findUnique({ where: { userId } });
    if (!affiliate) throw new AppError("Affiliate profile not found", 404);

    let mergedPayoutDetails: Record<string, unknown> =
      (affiliate.payoutDetails as Record<string, unknown>) || {};

    if (input.payoutDetails !== undefined && input.payoutDetails !== null) {
      mergedPayoutDetails = { ...mergedPayoutDetails, ...input.payoutDetails };
    }

    if (input.bankDetails !== undefined) {
      if (input.bankDetails === null) {
        delete mergedPayoutDetails.bankDetails;
      } else {
        mergedPayoutDetails = {
          ...mergedPayoutDetails,
          bankDetails: {
            bankName: input.bankDetails.bankName.trim(),
            accountHolderName: input.bankDetails.accountHolderName.trim(),
            accountNumber: input.bankDetails.accountNumber.trim(),
            branchName: input.bankDetails.branchName?.trim() || null,
            swiftBic: input.bankDetails.swiftBic?.trim() || null,
            routingNumber: input.bankDetails.routingNumber?.trim() || null,
          },
        };
      }
    }

    const payoutMethod =
      input.payoutMethod !== undefined
        ? input.payoutMethod
        : input.bankDetails
        ? "Bank Transfer"
        : affiliate.payoutMethod;

    return prisma.affiliate.update({
      where: { id: affiliate.id },
      data: {
        websiteUrl: input.websiteUrl !== undefined ? input.websiteUrl : affiliate.websiteUrl,
        promotionChannels:
          input.promotionChannels !== undefined ? input.promotionChannels : affiliate.promotionChannels,
        payoutMethod,
        payoutDetails: mergedPayoutDetails as Prisma.InputJsonValue,
      },
    });
  },

  async requireApprovedAffiliate(userId: string) {
    const affiliate = await prisma.affiliate.findUnique({
      where: { userId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    if (!affiliate) throw new AppError("Affiliate profile not found", 404);
    assertEligibleForAffiliate(affiliate.user.role);
    if (affiliate.status !== "APPROVED") {
      throw new AppError(`Affiliate account is ${affiliate.status}`, 403);
    }
    return affiliate;
  },

  async getMyDashboard(userId: string) {
    const affiliate = await prisma.affiliate.findUnique({ where: { userId } });
    if (!affiliate) throw new AppError("Affiliate profile not found", 404);

    const [totalClicks, referredBookings, balances, settings] = await Promise.all([
      prisma.affiliateClick.count({ where: { affiliateId: affiliate.id } }),
      prisma.affiliateBookingAttribution.count({ where: { affiliateId: affiliate.id } }),
      computeBalancesForAffiliate(prisma, affiliate.id),
      getOrCreateAffiliateSettings(),
    ]);

    const conversionRate =
      totalClicks > 0 ? Math.round((referredBookings / totalClicks) * 10000) / 100 : 0;

    return {
      affiliateId: affiliate.id,
      code: affiliate.code,
      status: affiliate.status,
      effectiveCommissionRate: resolveEffectiveRate(
        settings.globalCommissionRate.toString(),
        affiliate.commissionRateOverride?.toString() ?? null
      ),
      minimumPayoutAmount: Number(settings.minimumPayoutAmount),
      totalClicks,
      referredBookings,
      conversionRate,
      ...balances,
    };
  },

  async listMyLinks(userId: string) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const links = await prisma.affiliateLink.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: "desc" },
    });
    return { code: affiliate.code, links };
  },

  async createMyLink(
    userId: string,
    input: { label?: string | null; tourId?: string | null; targetPath?: string }
  ) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    let targetPath = input.targetPath?.trim() || "/";
    let campaignLabel = input.label?.trim() || null;

    if (input.tourId) {
      const tour = await prisma.service.findFirst({
        where: { id: input.tourId, status: "PUBLISHED" },
        select: { id: true, name: true },
      });
      if (!tour) {
        throw new AppError("Selected tour is not found or is not publicly published", 404);
      }
      targetPath = `/tours/${tour.id}`;
      if (!campaignLabel) {
        campaignLabel = tour.name;
      }
    } else {
      targetPath = "/";
      if (!campaignLabel) {
        campaignLabel = "PhuketTours Website";
      }
    }

    return prisma.affiliateLink.create({
      data: {
        affiliateId: affiliate.id,
        label: campaignLabel,
        tourId: input.tourId ?? null,
        targetPath,
      },
    });
  },

  async updateMyLink(
    userId: string,
    linkId: string,
    input: { label?: string; isActive?: boolean }
  ) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const existing = await prisma.affiliateLink.findFirst({
      where: { id: linkId, affiliateId: affiliate.id },
    });
    if (!existing) {
      throw new AppError("Affiliate link not found", 404);
    }

    return prisma.affiliateLink.update({
      where: { id: existing.id },
      data: {
        label: input.label !== undefined ? input.label.trim() : existing.label,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      },
    });
  },

  async deleteMyLink(userId: string, linkId: string) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const existing = await prisma.affiliateLink.findFirst({
      where: { id: linkId, affiliateId: affiliate.id },
      include: {
        _count: {
          select: {
            clicks: true,
          },
        },
      },
    });
    if (!existing) {
      throw new AppError("Affiliate link not found", 404);
    }

    // Safety rule: If the link has historical click records or was tracked,
    // de-activate it (isActive: false) and mark label with deleted suffix if not already,
    // OR if zero clicks exist, safely delete the link.
    // In both cases, past attribution is 100% preserved.
    if (existing._count.clicks > 0 || existing.clickCount > 0) {
      return prisma.affiliateLink.update({
        where: { id: existing.id },
        data: {
          isActive: false,
          label: existing.label?.startsWith("[Deleted] ")
            ? existing.label
            : `[Deleted] ${existing.label || "Link"}`,
        },
      });
    }

    await prisma.affiliateLink.delete({
      where: { id: existing.id },
    });

    return { id: existing.id, deleted: true };
  },

  async getMyClicks(userId: string, page = 1, limit = 20) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.affiliateClick.findMany({
        where: { affiliateId: affiliate.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          referralCode: true,
          landingUrl: true,
          referrer: true,
          expiresAt: true,
          createdAt: true,
          affiliateLinkId: true,
        },
      }),
      prisma.affiliateClick.count({ where: { affiliateId: affiliate.id } }),
    ]);
    return { items, total, page, limit };
  },

  async getMyBookings(userId: string, page = 1, limit = 20) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.affiliateBookingAttribution.findMany({
        where: { affiliateId: affiliate.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              currency: true,
              finalPrice: true,
              createdAt: true,
              service: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.affiliateBookingAttribution.count({ where: { affiliateId: affiliate.id } }),
    ]);
    return { items, total, page, limit };
  },

  async getMyCommissions(userId: string, page = 1, limit = 20) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const skip = (page - 1) * limit;
    const [items, total, balances] = await Promise.all([
      prisma.affiliateCommission.findMany({
        where: { affiliateId: affiliate.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              service: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.affiliateCommission.count({ where: { affiliateId: affiliate.id } }),
      computeBalancesForAffiliate(prisma, affiliate.id),
    ]);
    return { items, total, page, limit, balances };
  },

  async listMyPayouts(userId: string, page = 1, limit = 20) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const skip = (page - 1) * limit;
    const [items, total, balances] = await Promise.all([
      prisma.affiliatePayout.findMany({
        where: { affiliateId: affiliate.id },
        orderBy: { requestedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.affiliatePayout.count({ where: { affiliateId: affiliate.id } }),
      computeBalancesForAffiliate(prisma, affiliate.id),
    ]);
    return { items, total, page, limit, balances };
  },

  /**
   * Concurrency-safe payout request: locks the Affiliate row FOR UPDATE inside a transaction,
   * validates bank details presence, minimum threshold & available balance, and reserves the funds.
   */
  async requestPayout(
    userId: string,
    input: { amount: number; payoutMethod?: string; payoutDetails?: Record<string, unknown> | null }
  ) {
    const affiliate = await this.requireApprovedAffiliate(userId);
    const settings = await getOrCreateAffiliateSettings();

    // Verify affiliate has configured bank details
    const existingPayoutDetails = (affiliate.payoutDetails as Record<string, any>) || {};
    const effectiveBankDetails =
      input.payoutDetails?.bankDetails ||
      (input.payoutDetails?.bankName ? input.payoutDetails : existingPayoutDetails.bankDetails);

    if (
      !effectiveBankDetails ||
      !effectiveBankDetails.bankName?.trim() ||
      !effectiveBankDetails.accountHolderName?.trim() ||
      !effectiveBankDetails.accountNumber?.trim()
    ) {
      throw new AppError(
        "Please provide and save your bank details (Bank Name, Account Holder Name, Account Number) before requesting a payout.",
        400
      );
    }

    const requestedCents = toCents(input.amount);
    const minCents = toCents(settings.minimumPayoutAmount.toString());
    if (requestedCents < minCents) {
      throw new AppError(
        `Minimum payout amount is ${Number(settings.minimumPayoutAmount).toFixed(2)}`,
        400
      );
    }

    const payout = await prisma.$transaction(async (tx) => {
      // Row-level lock prevents concurrent payout requests from double-reserving the same funds
      await tx.$queryRaw`SELECT id FROM "Affiliate" WHERE id = ${affiliate.id} FOR UPDATE`;

      const balances = await computeBalancesForAffiliate(tx, affiliate.id);
      if (requestedCents > toCents(balances.availableBalance)) {
        throw new AppError(
          `Requested amount exceeds available balance (${balances.availableBalance.toFixed(2)})`,
          400
        );
      }

      const snapshot: Record<string, any> = {
        ...(existingPayoutDetails || {}),
        ...(input.payoutDetails || {}),
        bankDetails: {
          bankName: effectiveBankDetails.bankName.trim(),
          accountHolderName: effectiveBankDetails.accountHolderName.trim(),
          accountNumber: effectiveBankDetails.accountNumber.trim(),
          branchName: effectiveBankDetails.branchName?.trim() || null,
          swiftBic: effectiveBankDetails.swiftBic?.trim() || null,
          routingNumber: effectiveBankDetails.routingNumber?.trim() || null,
        },
      };

      const finalPayoutMethod = input.payoutMethod?.trim() || affiliate.payoutMethod || "Bank Transfer";

      const created = await tx.affiliatePayout.create({
        data: {
          affiliateId: affiliate.id,
          amount: input.amount,
          currency: "THB",
          status: "PENDING",
          payoutMethod: finalPayoutMethod,
          payoutDetailsSnapshot: snapshot as Prisma.InputJsonValue,
        },
      });

      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: affiliate.id,
          entityType: "PAYOUT",
          entityId: created.id,
          action: "PAYOUT_REQUESTED",
          actorId: userId,
          actorRole: "affiliate",
          metadata: { amount: input.amount, payoutMethod: finalPayoutMethod },
        },
      });

      return created;
    });

    if (affiliate.user?.email) {
      void affiliateNotification.notifyPayoutRequested({
        affiliateEmail: affiliate.user.email,
        affiliateName: affiliate.user.name,
        amount: Number(payout.amount),
        currency: payout.currency,
        payoutId: payout.id,
      });
    }

    return payout;
  },

  // ─── ADMIN MANAGEMENT ───────────────────────────────────────────────────────

  async getAdminOverview() {
    const [
      totalAffiliates,
      pendingApplications,
      approvedAffiliates,
      totalClicks,
      totalAttributedBookings,
      earnedAgg,
      pendingPayoutsAgg,
      paidPayoutsAgg,
      settings,
    ] = await Promise.all([
      prisma.affiliate.count(),
      prisma.affiliate.count({ where: { status: "PENDING" } }),
      prisma.affiliate.count({ where: { status: "APPROVED" } }),
      prisma.affiliateClick.count(),
      prisma.affiliateBookingAttribution.count(),
      prisma.affiliateCommission.aggregate({ _sum: { amount: true } }),
      prisma.affiliatePayout.aggregate({
        where: { status: { in: ["PENDING", "APPROVED"] } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.affiliatePayout.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true },
      }),
      getOrCreateAffiliateSettings(),
    ]);

    return {
      totalAffiliates,
      pendingApplications,
      approvedAffiliates,
      totalClicks,
      totalAttributedBookings,
      totalNetCommissions: Number(earnedAgg._sum.amount ?? 0),
      pendingPayoutsCount: pendingPayoutsAgg._count,
      pendingPayoutsAmount: Number(pendingPayoutsAgg._sum.amount ?? 0),
      totalPaidOut: Number(paidPayoutsAgg._sum.amount ?? 0),
      settings,
    };
  },

  async listAffiliates(params: { status?: string; search?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.AffiliateWhereInput = {};
    if (params.status && ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(params.status)) {
      where.status = params.status as "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { user: { name: { contains: q, mode: "insensitive" } } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.affiliate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true, role: true, status: true } },
          _count: { select: { clicks: true, attributions: true, commissions: true, payouts: true } },
        },
      }),
      prisma.affiliate.count({ where }),
    ]);

    return { items, total, page, limit };
  },

  async getAffiliateDetails(affiliateId: string) {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, status: true } },
        _count: { select: { clicks: true, attributions: true, commissions: true, payouts: true } },
      },
    });
    if (!affiliate) throw new AppError("Affiliate not found", 404);
    const [balances, settings] = await Promise.all([
      computeBalancesForAffiliate(prisma, affiliate.id),
      getOrCreateAffiliateSettings(),
    ]);
    return {
      ...affiliate,
      effectiveCommissionRate: resolveEffectiveRate(
        settings.globalCommissionRate.toString(),
        affiliate.commissionRateOverride?.toString() ?? null
      ),
      balances,
    };
  },

  async approveAffiliate(affiliateId: string, adminId: string) {
    const updated = await prisma.$transaction(async (tx) => {
      const affiliate = await tx.affiliate.findUnique({
        where: { id: affiliateId },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      });
      if (!affiliate) throw new AppError("Affiliate not found", 404);

      // Recheck eligibility inside transaction — never approve Agent/Staff/Admin
      if (INELIGIBLE_ROLES.has(affiliate.user.role)) {
        throw new AppError(
          `Cannot approve affiliate application for ineligible role (${affiliate.user.role})`,
          409
        );
      }

      // Preserve User.role — never overwrite Customer/Agent/Staff/Admin primary role
      const aff = await tx.affiliate.update({
        where: { id: affiliateId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: adminId,
          rejectionReason: null,
          suspendedAt: null,
        },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: aff.id,
          entityType: "AFFILIATE",
          entityId: aff.id,
          action: "AFFILIATE_APPROVED",
          actorId: adminId,
          actorRole: "admin",
        },
      });
      return { aff, user: affiliate.user };
    });

    void affiliateNotification.notifyAffiliateApplicationApproved({
      email: updated.user.email,
      name: updated.user.name,
      code: updated.aff.code,
    });

    return updated.aff;
  },

  async rejectAffiliate(affiliateId: string, adminId: string, reason: string) {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: affiliateId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!affiliate) throw new AppError("Affiliate not found", 404);

    const updated = await prisma.$transaction(async (tx) => {
      const aff = await tx.affiliate.update({
        where: { id: affiliateId },
        data: { status: "REJECTED", rejectionReason: reason },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: aff.id,
          entityType: "AFFILIATE",
          entityId: aff.id,
          action: "AFFILIATE_REJECTED",
          actorId: adminId,
          actorRole: "admin",
          metadata: { reason },
        },
      });
      return aff;
    });

    void affiliateNotification.notifyAffiliateApplicationRejected({
      email: affiliate.user.email,
      name: affiliate.user.name,
      reason,
    });

    return updated;
  },

  async suspendAffiliate(affiliateId: string, adminId: string, reason?: string) {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    if (!affiliate) throw new AppError("Affiliate not found", 404);

    return prisma.$transaction(async (tx) => {
      const aff = await tx.affiliate.update({
        where: { id: affiliateId },
        data: { status: "SUSPENDED", suspendedAt: new Date() },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: aff.id,
          entityType: "AFFILIATE",
          entityId: aff.id,
          action: "AFFILIATE_SUSPENDED",
          actorId: adminId,
          actorRole: "admin",
          metadata: reason ? { reason } : undefined,
        },
      });
      return aff;
    });
  },

  async reactivateAffiliate(affiliateId: string, adminId: string) {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    if (!affiliate) throw new AppError("Affiliate not found", 404);

    return prisma.$transaction(async (tx) => {
      const aff = await tx.affiliate.update({
        where: { id: affiliateId },
        data: { status: "APPROVED", suspendedAt: null },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: aff.id,
          entityType: "AFFILIATE",
          entityId: aff.id,
          action: "AFFILIATE_REACTIVATED",
          actorId: adminId,
          actorRole: "admin",
        },
      });
      return aff;
    });
  },

  async setAffiliateCommissionRate(
    affiliateId: string,
    adminId: string,
    commissionRateOverride: number | null
  ) {
    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    if (!affiliate) throw new AppError("Affiliate not found", 404);

    return prisma.$transaction(async (tx) => {
      const aff = await tx.affiliate.update({
        where: { id: affiliateId },
        data: { commissionRateOverride },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: aff.id,
          entityType: "AFFILIATE",
          entityId: aff.id,
          action: "COMMISSION_RATE_OVERRIDE_UPDATED",
          actorId: adminId,
          actorRole: "admin",
          metadata: {
            previousRate: affiliate.commissionRateOverride ? Number(affiliate.commissionRateOverride) : null,
            newRate: commissionRateOverride,
          },
        },
      });
      return aff;
    });
  },

  async getSettings() {
    return getOrCreateAffiliateSettings();
  },

  async updateSettings(
    adminId: string,
    input: {
      globalCommissionRate?: number;
      attributionWindowDays?: number;
      minimumPayoutAmount?: number;
      eligibleAmountPolicy?: "NET_AFTER_DISCOUNTS" | "GROSS";
      isProgramActive?: boolean;
    }
  ) {
    const current = await getOrCreateAffiliateSettings();
    return prisma.$transaction(async (tx) => {
      const updated = await tx.affiliateSettings.update({
        where: { id: "default" },
        data: {
          globalCommissionRate:
            input.globalCommissionRate !== undefined
              ? input.globalCommissionRate
              : current.globalCommissionRate,
          attributionWindowDays:
            input.attributionWindowDays !== undefined
              ? input.attributionWindowDays
              : current.attributionWindowDays,
          minimumPayoutAmount:
            input.minimumPayoutAmount !== undefined
              ? input.minimumPayoutAmount
              : current.minimumPayoutAmount,
          eligibleAmountPolicy:
            input.eligibleAmountPolicy !== undefined
              ? input.eligibleAmountPolicy
              : current.eligibleAmountPolicy,
          isProgramActive:
            input.isProgramActive !== undefined ? input.isProgramActive : current.isProgramActive,
          updatedById: adminId,
        },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          entityType: "SETTINGS",
          entityId: "default",
          action: "SETTINGS_UPDATED",
          actorId: adminId,
          actorRole: "admin",
          metadata: input as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  },

  async listAdminBookings(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.affiliateBookingAttribution.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          affiliate: {
            select: { id: true, code: true, user: { select: { name: true, email: true } } },
          },
          booking: {
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              currency: true,
              basePrice: true,
              finalPrice: true,
              createdAt: true,
              service: { select: { id: true, name: true } },
              customer: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      prisma.affiliateBookingAttribution.count(),
    ]);
    return { items, total, page, limit };
  },

  async listAdminCommissions(params: { affiliateId?: string; status?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.AffiliateCommissionWhereInput = {};
    if (params.affiliateId) where.affiliateId = params.affiliateId;
    if (params.status && ["PENDING", "AVAILABLE", "PAID", "REVERSED"].includes(params.status)) {
      where.status = params.status as "PENDING" | "AVAILABLE" | "PAID" | "REVERSED";
    }

    const [items, total] = await Promise.all([
      prisma.affiliateCommission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          affiliate: { select: { id: true, code: true, user: { select: { name: true, email: true } } } },
          booking: { select: { id: true, status: true, paymentStatus: true, finalPrice: true } },
        },
      }),
      prisma.affiliateCommission.count({ where }),
    ]);
    return { items, total, page, limit };
  },

  async listAdminPayouts(params: { status?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;
    const where: Prisma.AffiliatePayoutWhereInput = {};
    if (params.status && ["PENDING", "APPROVED", "REJECTED", "PAID"].includes(params.status)) {
      where.status = params.status as "PENDING" | "APPROVED" | "REJECTED" | "PAID";
    }

    const [items, total] = await Promise.all([
      prisma.affiliatePayout.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip,
        take: limit,
        include: {
          affiliate: { select: { id: true, code: true, user: { select: { name: true, email: true } } } },
          processedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.affiliatePayout.count({ where }),
    ]);
    return { items, total, page, limit };
  },

  async approvePayout(payoutId: string, adminId: string) {
    const payout = await prisma.affiliatePayout.findUnique({
      where: { id: payoutId },
      include: { affiliate: { include: { user: { select: { name: true, email: true } } } } },
    });
    if (!payout) throw new AppError("Payout request not found", 404);
    if (payout.status !== "PENDING") {
      throw new AppError(`Cannot approve payout in status ${payout.status}`, 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.affiliatePayout.update({
        where: { id: payoutId },
        data: { status: "APPROVED", processedById: adminId },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: p.affiliateId,
          entityType: "PAYOUT",
          entityId: p.id,
          action: "PAYOUT_APPROVED",
          actorId: adminId,
          actorRole: "admin",
        },
      });
      return p;
    });

    void affiliateNotification.notifyPayoutApproved({
      email: payout.affiliate.user.email,
      name: payout.affiliate.user.name,
      amount: Number(updated.amount),
      currency: updated.currency,
      payoutId: updated.id,
    });

    return updated;
  },

  async rejectPayout(payoutId: string, adminId: string, reason: string) {
    const payout = await prisma.affiliatePayout.findUnique({
      where: { id: payoutId },
      include: { affiliate: { include: { user: { select: { name: true, email: true } } } } },
    });
    if (!payout) throw new AppError("Payout request not found", 404);
    if (payout.status !== "PENDING" && payout.status !== "APPROVED") {
      throw new AppError(`Cannot reject payout in status ${payout.status}`, 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.affiliatePayout.update({
        where: { id: payoutId },
        data: { status: "REJECTED", rejectionReason: reason, processedById: adminId },
      });
      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: p.affiliateId,
          entityType: "PAYOUT",
          entityId: p.id,
          action: "PAYOUT_REJECTED",
          actorId: adminId,
          actorRole: "admin",
          metadata: { reason },
        },
      });
      return p;
    });

    void affiliateNotification.notifyPayoutRejected({
      email: payout.affiliate.user.email,
      name: payout.affiliate.user.name,
      amount: Number(updated.amount),
      currency: updated.currency,
      payoutId: updated.id,
      reason,
    });

    return updated;
  },

  async markPayoutPaid(
    payoutId: string,
    adminId: string,
    input: { payoutMethod?: string; transactionReference: string; paidAt?: string; notes?: string }
  ) {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AffiliatePayout" WHERE id = ${payoutId} FOR UPDATE`;
      const payout = await tx.affiliatePayout.findUnique({
        where: { id: payoutId },
        include: { affiliate: { include: { user: { select: { name: true, email: true } } } } },
      });
      if (!payout) throw new AppError("Payout request not found", 404);
      if (payout.status === "PAID") {
        throw new AppError("Payout has already been marked as paid", 409);
      }
      if (payout.status === "REJECTED") {
        throw new AppError("Cannot mark a rejected payout as paid", 400);
      }
      if (payout.status !== "APPROVED") {
        throw new AppError("Payout must be approved before being marked as paid", 400);
      }

      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
      const payoutMethod = input.payoutMethod?.trim() || payout.payoutMethod || "Bank Transfer";

      const p = await tx.affiliatePayout.update({
        where: { id: payoutId },
        data: {
          status: "PAID",
          payoutMethod,
          transactionReference: input.transactionReference.trim(),
          paidAt,
          processedById: adminId,
        },
      });

      await tx.affiliateAuditEvent.create({
        data: {
          affiliateId: p.affiliateId,
          entityType: "PAYOUT",
          entityId: p.id,
          action: "PAYOUT_MARKED_PAID",
          actorId: adminId,
          actorRole: "admin",
          metadata: {
            payoutMethod,
            transactionReference: input.transactionReference.trim(),
            paidAt: paidAt.toISOString(),
            amount: Number(p.amount),
            notes: input.notes?.trim() || undefined,
          },
        },
      });

      return { payout: p, user: payout.affiliate.user, payoutMethod };
    });

    void affiliateNotification.notifyPayoutPaid({
      email: updated.user.email,
      name: updated.user.name,
      amount: Number(updated.payout.amount),
      currency: updated.payout.currency,
      payoutId: updated.payout.id,
      method: updated.payoutMethod,
      reference: input.transactionReference.trim(),
    });

    return updated.payout;
  },

  async listAuditEvents(params: { affiliateId?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 30;
    const skip = (page - 1) * limit;
    const where: Prisma.AffiliateAuditEventWhereInput = params.affiliateId
      ? { affiliateId: params.affiliateId }
      : {};

    const [items, total] = await Promise.all([
      prisma.affiliateAuditEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, name: true, email: true, role: true } },
          affiliate: { select: { id: true, code: true } },
        },
      }),
      prisma.affiliateAuditEvent.count({ where }),
    ]);

    return { items, total, page, limit };
  },
};
