import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import * as pricingService from "../../pricingService.js";
vi.mock("../../pricingService.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    // Inject mock user based on test context
    req.user = req.headers["x-mock-role"] === "admin" 
      ? { id: "admin-1", role: "admin" } 
      : { id: "agent-1", role: "agent" };
    next();
  },
}));

describe("Pricing API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/admin/pricing-rules", () => {
    it("should return 200 and rules for admin", async () => {
      vi.mocked(pricingService.listPricingRules).mockResolvedValue([{ id: "1" }] as any);

      const res = await request(app)
        .get("/api/v1/admin/pricing-rules")
        .set("x-mock-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it("should return 403 for agent", async () => {
      const res = await request(app)
        .get("/api/v1/admin/pricing-rules")
        .set("x-mock-role", "agent");

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/v1/admin/pricing-rules", () => {
    it("should return 201 and create rule for admin", async () => {
      const mockRule = { id: "1", name: "10% Limit", type: "AGENT_DISCOUNT_LIMIT", value: 10 };
      vi.mocked(pricingService.createPricingRule).mockResolvedValue(mockRule as any);

      const res = await request(app)
        .post("/api/v1/admin/pricing-rules")
        .set("x-mock-role", "admin")
        .send({ name: "10% Limit", type: "AGENT_DISCOUNT_LIMIT", value: 10 });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("10% Limit");
    });

    it("should return 400 for invalid payload", async () => {
      const res = await request(app)
        .post("/api/v1/admin/pricing-rules")
        .set("x-mock-role", "admin")
        .send({ name: "Missing type and value" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/v1/agent/pricing-limits", () => {
    it("should return 200 and limits for agent", async () => {
      vi.mocked(pricingService.getAgentPricingLimit).mockResolvedValue({
        maxDiscountPercentage: 15,
        applicableRuleId: "r1",
      });

      const res = await request(app)
        .get("/api/v1/agent/pricing-limits")
        .set("x-mock-role", "agent");

      expect(res.status).toBe(200);
      expect(res.body.data.maxDiscountPercentage).toBe(15);
    });
  });
});

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";

