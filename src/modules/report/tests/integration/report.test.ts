import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import AppError from "../../../../shared/utils/AppError.js";
import * as reportService from "../../reportService.js";

vi.mock("../../reportService.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-mock-role"] as string;
    req.user = { id: `${role}-1`, role };
    next();
  },
}));

const get = (path: string, role: string) => request(app).get(path).set("x-mock-role", role);

const ADMIN_REPORTS = [
  ["bookings", "getAdminBookingsReport"],
  ["revenue", "getAdminRevenueReport"],
  ["payments", "getAdminPaymentsReport"],
  ["services", "getAdminServicesReport"],
  ["agents", "getAdminAgentsReport"],
  ["commissions", "getAdminCommissionsReport"],
] as const;

const AGENT_REPORTS = [
  ["bookings", "getAgentBookingsReport"],
  ["revenue", "getAgentRevenueReport"],
  ["commissions", "getAgentCommissionsReport"],
] as const;

describe("Report API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(ADMIN_REPORTS)("GET /api/v1/admin/reports/%s", (name, fn) => {
    const path = `/api/v1/admin/reports/${name}`;

    it.each(["customer", "agent", "staff"])("returns 403 for %s", async (role) => {
      const res = await get(path, role);
      expect(res.status).toBe(403);
      expect(reportService[fn]).not.toHaveBeenCalled();
    });

    it("returns 200 for an admin and forwards the query", async () => {
      vi.mocked(reportService[fn]).mockResolvedValue({ ok: true } as any);
      const res = await get(`${path}?from=2026-10-01`, "admin");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(reportService[fn]).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-10-01" }));
    });

    it("passes validation errors through", async () => {
      vi.mocked(reportService[fn]).mockRejectedValue(new AppError("Invalid from", 400));
      const res = await get(`${path}?from=bad`, "admin");
      expect(res.status).toBe(400);
    });
  });

  describe.each(AGENT_REPORTS)("GET /api/v1/agent/reports/%s", (name, fn) => {
    const path = `/api/v1/agent/reports/${name}`;

    it.each(["customer", "staff", "admin"])("returns 403 for %s", async (role) => {
      const res = await get(path, role);
      expect(res.status).toBe(403);
      expect(reportService[fn]).not.toHaveBeenCalled();
    });

    it("returns 200 for an agent and uses the agent id", async () => {
      vi.mocked(reportService[fn]).mockResolvedValue({ ok: true } as any);
      const res = await get(path, "agent");
      expect(res.status).toBe(200);
      expect(reportService[fn]).toHaveBeenCalledWith("agent-1", expect.anything());
    });
  });
});