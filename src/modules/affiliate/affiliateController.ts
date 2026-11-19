import type { Request, Response, NextFunction } from "express";
import { affiliateService } from "./affiliateService.js";
import { setAttributionCookie } from "./affiliateAttribution.js";
import sendResponse from "../../shared/utils/response.js";

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit };
}

export const affiliateController = {
  // Public
  async validateCode(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await affiliateService.validateCode(String(req.params.code));
      sendResponse(res, 200, true, "Referral code checked", result);
    } catch (err) {
      next(err);
    }
  },

  async trackClick(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await affiliateService.trackClick({
        code: req.body.code,
        landingUrl: req.body.landingUrl,
        referrer: req.body.referrer,
        linkId: req.body.linkId,
        ip: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });

      if (result.valid && result.attribution) {
        setAttributionCookie(res, result.attribution);
      }

      sendResponse(res, 200, true, result.valid ? "Referral click tracked" : "Referral code ignored", {
        valid: result.valid,
        code: result.attribution?.code ?? null,
      });
    } catch (err) {
      next(err);
    }
  },

  // Affiliate Portal
  async apply(req: Request, res: Response, next: NextFunction) {
    try {
      const affiliate = await affiliateService.applyAsAffiliate(req.user!.id, req.body);
      sendResponse(res, 201, true, "Affiliate application submitted", affiliate);
    } catch (err) {
      next(err);
    }
  },

  async getMyProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await affiliateService.getMyProfile(req.user!.id);
      sendResponse(res, 200, true, "Affiliate profile retrieved", profile);
    } catch (err) {
      next(err);
    }
  },

  async updateMyProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const updated = await affiliateService.updateMyProfile(req.user!.id, req.body);
      sendResponse(res, 200, true, "Affiliate profile updated", updated);
    } catch (err) {
      next(err);
    }
  },

  async getMyDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.getMyDashboard(req.user!.id);
      sendResponse(res, 200, true, "Affiliate dashboard retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async listMyLinks(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.listMyLinks(req.user!.id);
      sendResponse(res, 200, true, "Affiliate links retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async createMyLink(req: Request, res: Response, next: NextFunction) {
    try {
      const link = await affiliateService.createMyLink(req.user!.id, req.body);
      sendResponse(res, 201, true, "Affiliate link created", link);
    } catch (err) {
      next(err);
    }
  },

  async updateMyLink(req: Request, res: Response, next: NextFunction) {
    try {
      const link = await affiliateService.updateMyLink(req.user!.id, String(req.params.id), req.body);
      sendResponse(res, 200, true, "Affiliate link updated", link);
    } catch (err) {
      next(err);
    }
  },

  async deleteMyLink(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await affiliateService.deleteMyLink(req.user!.id, String(req.params.id));
      sendResponse(res, 200, true, "Affiliate link deleted successfully", result);
    } catch (err) {
      next(err);
    }
  },

  async getMyClicks(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.getMyClicks(req.user!.id, page, limit);
      sendResponse(res, 200, true, "Affiliate clicks retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async getMyBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.getMyBookings(req.user!.id, page, limit);
      sendResponse(res, 200, true, "Referred bookings retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async getMyCommissions(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.getMyCommissions(req.user!.id, page, limit);
      sendResponse(res, 200, true, "Affiliate commissions retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async listMyPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.listMyPayouts(req.user!.id, page, limit);
      sendResponse(res, 200, true, "Affiliate payouts retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async requestPayout(req: Request, res: Response, next: NextFunction) {
    try {
      const payout = await affiliateService.requestPayout(req.user!.id, req.body);
      sendResponse(res, 201, true, "Payout request submitted", payout);
    } catch (err) {
      next(err);
    }
  },

  // Admin
  async getAdminOverview(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.getAdminOverview();
      sendResponse(res, 200, true, "Affiliate overview retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async listAffiliates(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.listAffiliates({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        page,
        limit,
      });
      sendResponse(res, 200, true, "Affiliates retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async getAffiliateDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.getAffiliateDetails(String(req.params.id));
      sendResponse(res, 200, true, "Affiliate details retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async approveAffiliate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.approveAffiliate(String(req.params.id), req.user!.id);
      sendResponse(res, 200, true, "Affiliate approved", data);
    } catch (err) {
      next(err);
    }
  },

  async rejectAffiliate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.rejectAffiliate(
        String(req.params.id),
        req.user!.id,
        req.body.reason
      );
      sendResponse(res, 200, true, "Affiliate rejected", data);
    } catch (err) {
      next(err);
    }
  },

  async suspendAffiliate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.suspendAffiliate(
        String(req.params.id),
        req.user!.id,
        req.body?.reason
      );
      sendResponse(res, 200, true, "Affiliate suspended", data);
    } catch (err) {
      next(err);
    }
  },

  async reactivateAffiliate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.reactivateAffiliate(String(req.params.id), req.user!.id);
      sendResponse(res, 200, true, "Affiliate reactivated", data);
    } catch (err) {
      next(err);
    }
  },

  async setCommissionRate(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.setAffiliateCommissionRate(
        String(req.params.id),
        req.user!.id,
        req.body.commissionRateOverride
      );
      sendResponse(res, 200, true, "Affiliate commission rate updated", data);
    } catch (err) {
      next(err);
    }
  },

  async getSettings(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.getSettings();
      sendResponse(res, 200, true, "Affiliate settings retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.updateSettings(req.user!.id, req.body);
      sendResponse(res, 200, true, "Affiliate settings updated", data);
    } catch (err) {
      next(err);
    }
  },

  async listAdminBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.listAdminBookings(page, limit);
      sendResponse(res, 200, true, "Attributed bookings retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async listAdminCommissions(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.listAdminCommissions({
        affiliateId: typeof req.query.affiliateId === "string" ? req.query.affiliateId : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        page,
        limit,
      });
      sendResponse(res, 200, true, "Affiliate commissions retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async listAdminPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.listAdminPayouts({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        page,
        limit,
      });
      sendResponse(res, 200, true, "Affiliate payouts retrieved", data);
    } catch (err) {
      next(err);
    }
  },

  async approvePayout(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.approvePayout(String(req.params.id), req.user!.id);
      sendResponse(res, 200, true, "Payout approved", data);
    } catch (err) {
      next(err);
    }
  },

  async rejectPayout(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.rejectPayout(
        String(req.params.id),
        req.user!.id,
        req.body.reason
      );
      sendResponse(res, 200, true, "Payout rejected", data);
    } catch (err) {
      next(err);
    }
  },

  async markPayoutPaid(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await affiliateService.markPayoutPaid(
        String(req.params.id),
        req.user!.id,
        req.body
      );
      sendResponse(res, 200, true, "Payout marked as paid", data);
    } catch (err) {
      next(err);
    }
  },

  async listAuditEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query);
      const data = await affiliateService.listAuditEvents({
        affiliateId: typeof req.query.affiliateId === "string" ? req.query.affiliateId : undefined,
        page,
        limit,
      });
      sendResponse(res, 200, true, "Affiliate audit events retrieved", data);
    } catch (err) {
      next(err);
    }
  },
};
