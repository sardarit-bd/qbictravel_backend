import { Router } from "express";
import { affiliateController } from "./affiliateController.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import validate from "../../shared/middleware/validate.js";
import {
  applyAffiliateSchema,
  createAffiliateLinkSchema,
  markPayoutPaidSchema,
  rejectReasonSchema,
  requestPayoutSchema,
  setCommissionRateSchema,
  trackClickSchema,
  updateAffiliateProfileSchema,
  updateAffiliateSettingsSchema,
} from "./affiliateValidation.js";

// 1. Public Referral Tracking Router (/api/v1/affiliates)
export const publicAffiliateRouter = Router();
publicAffiliateRouter.get("/validate/:code", affiliateController.validateCode);
publicAffiliateRouter.post("/track-click", validate(trackClickSchema), affiliateController.trackClick);

// 2. Affiliate Portal Router (/api/v1/affiliate)
export const affiliatePortalRouter = Router();
affiliatePortalRouter.use(authMiddleware, (req, res, next) => {
  const role = req.user?.role;
  if (role === "agent" || role === "staff" || role === "admin") {
    res.status(403).json({
      success: false,
      message: "Agent, Staff, and Admin accounts are not eligible for the Affiliate Program",
    });
    return;
  }
  next();
});
affiliatePortalRouter.post("/apply", validate(applyAffiliateSchema), affiliateController.apply);
affiliatePortalRouter.get("/me", affiliateController.getMyProfile);
affiliatePortalRouter.patch("/profile", validate(updateAffiliateProfileSchema), affiliateController.updateMyProfile);
affiliatePortalRouter.get("/dashboard", affiliateController.getMyDashboard);
affiliatePortalRouter.get("/links", affiliateController.listMyLinks);
affiliatePortalRouter.post("/links", validate(createAffiliateLinkSchema), affiliateController.createMyLink);
affiliatePortalRouter.get("/clicks", affiliateController.getMyClicks);
affiliatePortalRouter.get("/bookings", affiliateController.getMyBookings);
affiliatePortalRouter.get("/commissions", affiliateController.getMyCommissions);
affiliatePortalRouter.get("/payouts", affiliateController.listMyPayouts);
affiliatePortalRouter.post("/payouts", validate(requestPayoutSchema), affiliateController.requestPayout);

// 3. Admin Affiliate Management Router (/api/v1/admin/affiliates)
export const adminAffiliateRouter = Router();
adminAffiliateRouter.use(authMiddleware, requireRole("admin"));
adminAffiliateRouter.get("/overview", affiliateController.getAdminOverview);
adminAffiliateRouter.get("/settings", affiliateController.getSettings);
adminAffiliateRouter.patch("/settings", validate(updateAffiliateSettingsSchema), affiliateController.updateSettings);
adminAffiliateRouter.get("/bookings", affiliateController.listAdminBookings);
adminAffiliateRouter.get("/commissions", affiliateController.listAdminCommissions);
adminAffiliateRouter.get("/payouts", affiliateController.listAdminPayouts);
adminAffiliateRouter.patch("/payouts/:id/approve", affiliateController.approvePayout);
adminAffiliateRouter.patch("/payouts/:id/reject", validate(rejectReasonSchema), affiliateController.rejectPayout);
adminAffiliateRouter.patch("/payouts/:id/mark-paid", validate(markPayoutPaidSchema), affiliateController.markPayoutPaid);
adminAffiliateRouter.get("/audit-events", affiliateController.listAuditEvents);
adminAffiliateRouter.get("/", affiliateController.listAffiliates);
adminAffiliateRouter.get("/:id", affiliateController.getAffiliateDetails);
adminAffiliateRouter.patch("/:id/approve", affiliateController.approveAffiliate);
adminAffiliateRouter.patch("/:id/reject", validate(rejectReasonSchema), affiliateController.rejectAffiliate);
adminAffiliateRouter.patch("/:id/suspend", affiliateController.suspendAffiliate);
adminAffiliateRouter.patch("/:id/reactivate", affiliateController.reactivateAffiliate);
adminAffiliateRouter.patch(
  "/:id/commission-rate",
  validate(setCommissionRateSchema),
  affiliateController.setCommissionRate
);
