import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import AppError from "../../../../shared/utils/AppError.js";
import * as commissionService from "../../commissionService.js";

vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (role === "admin") {
      req.user = { id: "admin-1", role: "admin", name: "Admin" };
    } else if (role === "agent") {
      req.user = { id: "agent-1", role: "agent", name: "Agent" };
    }
    next();
  },
}));

vi.mock("../../../../shared/middleware/requireRole.js", () => ({
  default: (expectedRole: string) => (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (req.user.role !== expectedRole) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  },
}));

vi.mock("../../commissionService.js");

const COMMISSION_ID = "00000000-0000-4000-8000-000000000001";
const POLICY_ID = "00000000-0000-4000-8000-000000000002";

const call = (method: "get" | "patch" | "put" | "post" | "delete", url: string, role?: string, body?: unknown) => {
  let req = (request(app) as any)[method](url);
  if (role) req = req.set("x-test-role", role);
  if (body) req = req.send(body);
  return req;
};

describe("Commission routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Access control", () => {
    it.each([
      ["get", "/api/v1/agent/commissions", "admin", 403],
      ["get", "/api/v1/admin/commissions", "agent", 403],
      ["get", "/api/v1/admin/commission-rules", "agent", 403],
      ["patch", `/api/v1/admin/commissions/${COMMISSION_ID}`, "agent", 403],
      ["put", "/api/v1/admin/commission-rules", "agent", 403],
      ["post", "/api/v1/admin/commission-rules", "agent", 403],
      ["get", `/api/v1/admin/commission-rules/${POLICY_ID}`, "agent", 403],
      ["patch", `/api/v1/admin/commission-rules/${POLICY_ID}`, "agent", 403],
      ["post", `/api/v1/admin/commission-rules/${POLICY_ID}/publish`, "agent", 403],
      ["post", `/api/v1/admin/commission-rules/${POLICY_ID}/deactivate`, "agent", 403],
      ["post", `/api/v1/admin/commission-rules/${POLICY_ID}/archive`, "agent", 403],
      ["delete", `/api/v1/admin/commission-rules/${POLICY_ID}`, "agent", 403],
      ["post", `/api/v1/admin/commission-rules/${POLICY_ID}/revision`, "agent", 403],
      ["get", "/api/v1/agent/commissions", undefined, 401],
      ["get", "/api/v1/admin/commissions", undefined, 401],
    ])("%s %s blocks %s with %i", async (method, url, role, expectedStatus) => {
      const res = await call(method as any, url, role, method === "patch" ? { amount: 5, reason: "Why" } : {});
      expect(res.status).toBe(expectedStatus);
    });
  });

  describe("GET endpoints", () => {
    it("GET /agent/commissions returns 200", async () => {
      vi.mocked(commissionService.listAgentCommissions).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);
      const res = await call("get", "/api/v1/agent/commissions", "agent");
      expect(res.status).toBe(200);
      expect(commissionService.listAgentCommissions).toHaveBeenCalledWith("agent-1", expect.any(Object));
    });

    it("GET /agent/commissions/:id returns 200", async () => {
      vi.mocked(commissionService.getAgentCommission).mockResolvedValue({ id: COMMISSION_ID } as any);
      const res = await call("get", `/api/v1/agent/commissions/${COMMISSION_ID}`, "agent");
      expect(res.status).toBe(200);
      expect(commissionService.getAgentCommission).toHaveBeenCalledWith("agent-1", COMMISSION_ID);
    });

    it("GET /agent/commissions/:id returns 400 for an invalid id", async () => {
      const res = await call("get", "/api/v1/agent/commissions/not-a-uuid", "agent");
      expect(res.status).toBe(400);
      expect(commissionService.getAgentCommission).not.toHaveBeenCalled();
    });

    it("GET /admin/commissions returns 200", async () => {
      vi.mocked(commissionService.listAdminCommissions).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);
      const res = await call("get", "/api/v1/admin/commissions", "admin");
      expect(res.status).toBe(200);
    });

    it("GET /admin/commissions with valid filters passes them through", async () => {
      vi.mocked(commissionService.listAdminCommissions).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);
      const res = await call("get", "/api/v1/admin/commissions?status=CANCELLED", "admin");
      expect(res.status).toBe(200);
      expect(commissionService.listAdminCommissions).toHaveBeenCalledWith(expect.objectContaining({ status: "CANCELLED" }));
    });

    it("GET /admin/commissions/:id returns 200", async () => {
      vi.mocked(commissionService.getAdminCommission).mockResolvedValue({ id: COMMISSION_ID } as any);
      const res = await call("get", `/api/v1/admin/commissions/${COMMISSION_ID}`, "admin");
      expect(res.status).toBe(200);
    });

    it("GET /admin/commissions/:id returns 400 for an invalid id", async () => {
      const res = await call("get", "/api/v1/admin/commissions/not-a-uuid", "admin");
      expect(res.status).toBe(400);
    });

    it("GET /admin/commission-rules returns 200", async () => {
      vi.mocked(commissionService.getRules).mockResolvedValue({ activeRule: null, items: [], page: 1, limit: 20, total: 0 } as any);
      const res = await call("get", "/api/v1/admin/commission-rules", "admin");
      expect(res.status).toBe(200);
    });

    it("GET /admin/commission-rules/:policyId returns 200", async () => {
      vi.mocked(commissionService.getPolicyById).mockResolvedValue({ id: POLICY_ID } as any);
      const res = await call("get", `/api/v1/admin/commission-rules/${POLICY_ID}`, "admin");
      expect(res.status).toBe(200);
      expect(commissionService.getPolicyById).toHaveBeenCalledWith(POLICY_ID);
    });
  });

  describe("PATCH /api/v1/admin/commissions/:commissionId", () => {
    const url = `/api/v1/admin/commissions/${COMMISSION_ID}`;

    it("returns 200 on a valid adjustment", async () => {
      vi.mocked(commissionService.adjustCommission).mockResolvedValue({ id: COMMISSION_ID, amount: 40 } as any);
      const res = await call("patch", url, "admin", { amount: 40, reason: "Discount agreed" });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Commission adjusted successfully");
      expect(commissionService.adjustCommission).toHaveBeenCalledWith(
        "admin-1",
        COMMISSION_ID,
        expect.objectContaining({ amount: 40, reason: "Discount agreed" }),
      );
    });

    it.each([
      ["missing reason", { amount: 40 }],
      ["missing amount", { reason: "Discount" }],
      ["short reason", { amount: 40, reason: "ab" }],
      ["negative amount", { amount: -5, reason: "Discount" }],
      ["too many decimals", { amount: 10.123, reason: "Discount" }],
    ])("returns 400 for %s", async (_label, body) => {
      const res = await call("patch", url, "admin", body);
      expect(res.status).toBe(400);
      expect(commissionService.adjustCommission).not.toHaveBeenCalled();
    });

    it("passes service errors through", async () => {
      vi.mocked(commissionService.adjustCommission).mockRejectedValue(new AppError("Only an active commission can be adjusted", 409));
      const res = await call("patch", url, "admin", { amount: 40, reason: "Discount" });
      expect(res.status).toBe(409);
    });
  });

  describe("Commission Policy Management Endpoints", () => {
    it("POST /admin/commission-rules creates a draft policy", async () => {
      vi.mocked(commissionService.createDraftPolicy).mockResolvedValue({ id: POLICY_ID, status: "DRAFT" } as any);
      const res = await call("post", "/api/v1/admin/commission-rules", "admin", { name: "Standard 12%", rateType: "PERCENTAGE", rateValue: 12 });
      expect(res.status).toBe(201);
      expect(commissionService.createDraftPolicy).toHaveBeenCalledWith("admin-1", { name: "Standard 12%", rateType: "PERCENTAGE", rateValue: 12 });
    });

    it("PATCH /admin/commission-rules/:policyId updates draft policy", async () => {
      vi.mocked(commissionService.updatePolicy).mockResolvedValue({ id: POLICY_ID, rateValue: 15 } as any);
      const res = await call("patch", `/api/v1/admin/commission-rules/${POLICY_ID}`, "admin", { rateValue: 15 });
      expect(res.status).toBe(200);
      expect(commissionService.updatePolicy).toHaveBeenCalledWith("admin-1", POLICY_ID, { rateValue: 15 });
    });

    it("POST /admin/commission-rules/:policyId/publish publishes policy", async () => {
      vi.mocked(commissionService.publishPolicy).mockResolvedValue({ id: POLICY_ID, status: "ACTIVE" } as any);
      const res = await call("post", `/api/v1/admin/commission-rules/${POLICY_ID}/publish`, "admin");
      expect(res.status).toBe(200);
      expect(commissionService.publishPolicy).toHaveBeenCalledWith("admin-1", POLICY_ID);
    });

    it("POST /admin/commission-rules/:policyId/deactivate deactivates policy", async () => {
      vi.mocked(commissionService.deactivatePolicy).mockResolvedValue({ id: POLICY_ID, status: "INACTIVE" } as any);
      const res = await call("post", `/api/v1/admin/commission-rules/${POLICY_ID}/deactivate`, "admin");
      expect(res.status).toBe(200);
      expect(commissionService.deactivatePolicy).toHaveBeenCalledWith("admin-1", POLICY_ID);
    });

    it("POST /admin/commission-rules/:policyId/archive archives policy", async () => {
      vi.mocked(commissionService.archivePolicy).mockResolvedValue({ id: POLICY_ID, status: "ARCHIVED" } as any);
      const res = await call("post", `/api/v1/admin/commission-rules/${POLICY_ID}/archive`, "admin");
      expect(res.status).toBe(200);
      expect(commissionService.archivePolicy).toHaveBeenCalledWith("admin-1", POLICY_ID);
    });

    it("DELETE /admin/commission-rules/:policyId deletes draft policy", async () => {
      vi.mocked(commissionService.deletePolicy).mockResolvedValue({ id: POLICY_ID, deleted: true } as any);
      const res = await call("delete", `/api/v1/admin/commission-rules/${POLICY_ID}`, "admin");
      expect(res.status).toBe(200);
      expect(commissionService.deletePolicy).toHaveBeenCalledWith("admin-1", POLICY_ID);
    });

    it("POST /admin/commission-rules/disable disables platform commission", async () => {
      vi.mocked(commissionService.disableCommission).mockResolvedValue({ disabled: true, deactivatedCount: 1 } as any);
      const res = await call("post", "/api/v1/admin/commission-rules/disable", "admin");
      expect(res.status).toBe(200);
      expect(commissionService.disableCommission).toHaveBeenCalledWith("admin-1");
    });

    it("POST /admin/commission-rules/:policyId/revision creates revision", async () => {
      vi.mocked(commissionService.createRevision).mockResolvedValue({ id: "policy-rev-2", status: "DRAFT" } as any);
      const res = await call("post", `/api/v1/admin/commission-rules/${POLICY_ID}/revision`, "admin", { rateValue: 14 });
      expect(res.status).toBe(201);
      expect(commissionService.createRevision).toHaveBeenCalledWith("admin-1", POLICY_ID, { rateValue: 14 });
    });
  });

  describe("PUT /api/v1/admin/commission-rules", () => {
    const url = "/api/v1/admin/commission-rules";

    it("returns 200 for a percentage rule", async () => {
      vi.mocked(commissionService.configureRule).mockResolvedValue({ id: "rule-1" } as any);
      const res = await call("put", url, "admin", { rateType: "PERCENTAGE", rateValue: 10 });
      expect(res.status).toBe(200);
      expect(commissionService.configureRule).toHaveBeenCalledWith("admin-1", expect.objectContaining({ rateType: "PERCENTAGE" }));
    });

    it("returns 200 for a fixed rule above 100", async () => {
      vi.mocked(commissionService.configureRule).mockResolvedValue({ id: "rule-1" } as any);
      const res = await call("put", url, "admin", { rateType: "FIXED", rateValue: 250 });
      expect(res.status).toBe(200);
    });

    it.each([
      ["missing body", {}],
      ["invalid rate type", { rateType: "BONUS", rateValue: 5 }],
      ["percentage above 100", { rateType: "PERCENTAGE", rateValue: 150 }],
      ["zero value", { rateType: "FIXED", rateValue: 0 }],
      ["negative value", { rateType: "FIXED", rateValue: -5 }],
      ["too many decimals", { rateType: "FIXED", rateValue: 5.555 }],
      ["missing value", { rateType: "FIXED" }],
    ])("returns 400 for %s", async (_label, body) => {
      const res = await call("put", url, "admin", body);
      expect(res.status).toBe(400);
      expect(commissionService.configureRule).not.toHaveBeenCalled();
    });
  });
});
