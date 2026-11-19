import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    req.user = {
      id: req.headers["x-test-user-id"] || "user-1",
      name: "Test User",
      email: "test@example.com",
      role: req.headers["x-test-role"] || "affiliate",
    };
    next();
  },
}));

vi.mock("../../../../shared/middleware/requireRole.js", () => ({
  default: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }
    next();
  },
}));

vi.mock("../../affiliateService.js", () => ({
  affiliateService: {
    validateCode: vi.fn(),
    trackClick: vi.fn(),
    applyAsAffiliate: vi.fn(),
    getMyProfile: vi.fn(),
    getMyDashboard: vi.fn(),
    requestPayout: vi.fn(),
    getAdminOverview: vi.fn(),
    approveAffiliate: vi.fn(),
    rejectAffiliate: vi.fn(),
    markPayoutPaid: vi.fn(),
  },
}));

import app from "../../../../app.js";
import { affiliateService } from "../../affiliateService.js";
import { AFFILIATE_COOKIE_NAME } from "../../affiliateAttribution.js";

describe("Affiliate API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v1/affiliates/track-click sets HttpOnly signed cookie for valid code", async () => {
    vi.mocked(affiliateService.trackClick).mockResolvedValue({
      valid: true,
      attribution: {
        clickId: "click-1",
        affiliateId: "aff-1",
        code: "AFF1025",
        exp: Date.now() + 86400_000,
      },
    });

    const res = await request(app)
      .post("/api/v1/affiliates/track-click")
      .send({ code: "AFF1025", landingUrl: "/tours/phi-phi" });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies?.some((c) => c.startsWith(`${AFFILIATE_COOKIE_NAME}=`) && c.includes("HttpOnly"))).toBe(true);
  });

  it("POST /api/v1/affiliate/apply submits affiliate application", async () => {
    vi.mocked(affiliateService.applyAsAffiliate).mockResolvedValue({
      id: "aff-1",
      code: "AFF9999",
      status: "PENDING",
    } as any);

    const res = await request(app)
      .post("/api/v1/affiliate/apply")
      .set("x-test-role", "customer")
      .send({ websiteUrl: "https://travelblog.example.com" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING");
  });

  it("blocks Agent, Staff, and Admin from applying or accessing Affiliate portal endpoints (403)", async () => {
    for (const role of ["agent", "staff", "admin"]) {
      const applyRes = await request(app)
        .post("/api/v1/affiliate/apply")
        .set("x-test-role", role)
        .send({ promotionChannels: "My channel" });
      expect(applyRes.status).toBe(403);

      const dashRes = await request(app)
        .get("/api/v1/affiliate/dashboard")
        .set("x-test-role", role);
      expect(dashRes.status).toBe(403);
    }
  });

  it("GET /api/v1/admin/affiliates/overview blocks non-admin roles with 403", async () => {
    const res = await request(app)
      .get("/api/v1/admin/affiliates/overview")
      .set("x-test-role", "affiliate");

    expect(res.status).toBe(403);
  });

  it("PATCH /api/v1/admin/affiliates/:id/reject requires a rejection reason", async () => {
    const res = await request(app)
      .patch("/api/v1/admin/affiliates/aff-1/reject")
      .set("x-test-role", "admin")
      .send({ reason: "" });

    expect(res.status).toBe(400);
  });

  it("PATCH /api/v1/admin/affiliates/payouts/:id/mark-paid records manual payout reference", async () => {
    vi.mocked(affiliateService.markPayoutPaid).mockResolvedValue({
      id: "pay-1",
      status: "PAID",
      transactionReference: "TXN-2026-001",
    } as any);

    const res = await request(app)
      .patch("/api/v1/admin/affiliates/payouts/pay-1/mark-paid")
      .set("x-test-role", "admin")
      .send({ payoutMethod: "Bank Transfer", transactionReference: "TXN-2026-001" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PAID");
    expect(res.body.data.transactionReference).toBe("TXN-2026-001");
  });
});
