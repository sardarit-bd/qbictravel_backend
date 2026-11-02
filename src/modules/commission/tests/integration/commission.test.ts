import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import AppError from "../../../../shared/utils/AppError.js";
import * as commissionService from "../../commissionService.js";

vi.mock("../../commissionService.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-mock-role"] as string;
    req.user = { id: `${role}-1`, role };
    next();
  },
}));

const COMMISSION_ID = "123e4567-e89b-12d3-a456-426614174020";

const call = (method: "get" | "patch" | "put", path: string, role: string, body?: object) => {
  const req = request(app)[method](path).set("x-mock-role", role);
  return body ? req.send(body) : req;
};

describe("Commission API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("role guards", () => {
    it.each([
      ["get", "/api/v1/agent/commissions", "customer"],
      ["get", "/api/v1/agent/commissions", "staff"],
      ["get", "/api/v1/agent/commissions", "admin"],
      ["get", `/api/v1/agent/commissions/${COMMISSION_ID}`, "customer"],
      ["get", "/api/v1/admin/commissions", "agent"],
      ["get", "/api/v1/admin/commissions", "staff"],
      ["get", `/api/v1/admin/commissions/${COMMISSION_ID}`, "agent"],
      ["patch", `/api/v1/admin/commissions/${COMMISSION_ID}`, "agent"],
      ["patch", `/api/v1/admin/commissions/${COMMISSION_ID}`, "staff"],
      ["get", "/api/v1/admin/commission-rules", "agent"],
      ["put", "/api/v1/admin/commission-rules", "agent"],
      ["put", "/api/v1/admin/commission-rules", "staff"],
    ] as const)("%s %s returns 403 for %s", async (method, path, role) => {
      const res = await call(method, path, role, method === "get" ? undefined : { rateType: "FIXED", rateValue: 5 });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe("agent reads", () => {
    it("GET /agent/commissions returns 200 and uses the agent id", async () => {
      vi.mocked(commissionService.listAgentCommissions).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);
      const res = await call("get", "/api/v1/agent/commissions?status=ACTIVE", "agent");
      expect(res.status).toBe(200);
      expect(commissionService.listAgentCommissions).toHaveBeenCalledWith("agent-1", expect.objectContaining({ status: "ACTIVE" }));
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
    });

    it("GET /agent/commissions/:id passes a 404 through", async () => {
      vi.mocked(commissionService.getAgentCommission).mockRejectedValue(new AppError("Commission not found", 404));
      const res = await call("get", `/api/v1/agent/commissions/${COMMISSION_ID}`, "agent");
      expect(res.status).toBe(404);
    });
  });

  describe("admin reads", () => {
    it("GET /admin/commissions returns 200 and forwards filters", async () => {
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
  });

  describe("PATCH /api/v1/admin/commissions/:commissionId", () => {
    const url = `/api/v1/admin/commissions/${COMMISSION_ID}`;

    it("returns 200 and forwards the admin id and body", async () => {
      vi.mocked(commissionService.adjustCommission).mockResolvedValue({ id: COMMISSION_ID, amount: 40 } as any);
      const res = await call("patch", url, "admin", { amount: 40, reason: "Discount" });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Commission adjusted successfully");
      expect(commissionService.adjustCommission).toHaveBeenCalledWith(
        "admin-1",
        COMMISSION_ID,
        expect.objectContaining({ amount: 40, reason: "Discount" }),
      );
    });

    it.each([
      ["missing amount", { reason: "Discount" }],
      ["missing reason", { amount: 40 }],
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