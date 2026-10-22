import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import AppError from "../../../../shared/utils/AppError.js";
import * as paymentService from "../../paymentService.js";

vi.mock("../../paymentService.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-mock-role"] as string;
    req.user = { id: `${role}-1`, role };
    next();
  },
}));

const BOOKING_ID = "123e4567-e89b-12d3-a456-426614174002";
const PAYMENT_ID = "123e4567-e89b-12d3-a456-426614174003";

const call = (method: "get" | "post", path: string, role: string, body?: object) => {
  const req = request(app)[method](path).set("x-mock-role", role);
  return body ? req.send(body) : req;
};

describe("Payment API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("role guards", () => {
    it.each([
      ["post", `/api/v1/bookings/${BOOKING_ID}/payments`, "agent"],
      ["post", `/api/v1/bookings/${BOOKING_ID}/payments`, "admin"],
      ["get", "/api/v1/customer/payments", "admin"],
      ["get", `/api/v1/customer/payments/${PAYMENT_ID}`, "agent"],
      ["get", "/api/v1/agent/payments", "customer"],
      ["get", "/api/v1/admin/payments", "staff"],
      ["get", `/api/v1/admin/payments/${PAYMENT_ID}`, "agent"],
      ["post", `/api/v1/admin/payments/${PAYMENT_ID}/verify`, "staff"],
      ["post", `/api/v1/admin/payments/${PAYMENT_ID}/verify`, "customer"],
      ["post", `/api/v1/admin/payments/${PAYMENT_ID}/record`, "staff"],
      ["post", `/api/v1/admin/payments/${PAYMENT_ID}/record`, "agent"],
    ] as const)("%s %s returns 403 for %s", async (method, path, role) => {
      const res = await call(method, path, role, method === "post" ? { method: "CASH", decision: "VERIFIED" } : undefined);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/v1/bookings/:bookingId/payments", () => {
    it("returns 201 and the submitted message when a receipt is sent", async () => {
      vi.mocked(paymentService.createPayment).mockResolvedValue({ id: PAYMENT_ID, status: "SUBMITTED" } as any);

      const res = await call("post", `/api/v1/bookings/${BOOKING_ID}/payments`, "customer", {
        method: "BANK_TRANSFER",
        reference: "TRX-1001",
      });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Payment receipt submitted and awaiting verification");
      expect(paymentService.createPayment).toHaveBeenCalledWith(
        "customer-1",
        BOOKING_ID,
        expect.objectContaining({ method: "BANK_TRANSFER", reference: "TRX-1001" }),
      );
    });

    it("returns 201 and the initiated message without a reference", async () => {
      vi.mocked(paymentService.createPayment).mockResolvedValue({ id: PAYMENT_ID, status: "INITIATED" } as any);

      const res = await call("post", `/api/v1/bookings/${BOOKING_ID}/payments`, "customer", { method: "CASH" });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Payment initiated");
    });

    it.each([
      ["missing method", {}],
      ["invalid method", { method: "BITCOIN" }],
      ["too short reference", { method: "CASH", reference: "ab" }],
      ["too long receipt note", { method: "CASH", receiptNote: "x".repeat(501) }],
    ])("returns 400 for %s", async (_label, body) => {
      const res = await call("post", `/api/v1/bookings/${BOOKING_ID}/payments`, "customer", body);
      expect(res.status).toBe(400);
      expect(paymentService.createPayment).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid booking ID", async () => {
      const res = await call("post", "/api/v1/bookings/not-a-uuid/payments", "customer", { method: "CASH" });
      expect(res.status).toBe(400);
      expect(paymentService.createPayment).not.toHaveBeenCalled();
    });

    it("passes service errors through with their status code", async () => {
      vi.mocked(paymentService.createPayment).mockRejectedValue(
        new AppError("This booking already has an active payment", 409),
      );
      const res = await call("post", `/api/v1/bookings/${BOOKING_ID}/payments`, "customer", { method: "CASH" });
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe("customer reads", () => {
    it("GET /customer/payments returns 200 and forwards the query", async () => {
      vi.mocked(paymentService.listCustomerPayments).mockResolvedValue({ items: [], page: 2, limit: 5, total: 0 } as any);

      const res = await call("get", "/api/v1/customer/payments?status=VERIFIED&page=2", "customer");

      expect(res.status).toBe(200);
      expect(paymentService.listCustomerPayments).toHaveBeenCalledWith(
        "customer-1",
        expect.objectContaining({ status: "VERIFIED", page: "2" }),
      );
    });

    it("GET /customer/payments/:paymentId returns 200", async () => {
      vi.mocked(paymentService.getCustomerPayment).mockResolvedValue({ id: PAYMENT_ID } as any);

      const res = await call("get", `/api/v1/customer/payments/${PAYMENT_ID}`, "customer");

      expect(res.status).toBe(200);
      expect(paymentService.getCustomerPayment).toHaveBeenCalledWith("customer-1", PAYMENT_ID);
    });

    it("GET /customer/payments/:paymentId returns 400 for an invalid ID", async () => {
      const res = await call("get", "/api/v1/customer/payments/not-a-uuid", "customer");
      expect(res.status).toBe(400);
    });

    it("GET /customer/payments/:paymentId passes a 404 through", async () => {
      vi.mocked(paymentService.getCustomerPayment).mockRejectedValue(new AppError("Payment not found", 404));
      const res = await call("get", `/api/v1/customer/payments/${PAYMENT_ID}`, "customer");
      expect(res.status).toBe(404);
    });
  });

  describe("agent reads", () => {
    it("GET /agent/payments returns 200 for the agent", async () => {
      vi.mocked(paymentService.listAgentPayments).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);

      const res = await call("get", "/api/v1/agent/payments", "agent");

      expect(res.status).toBe(200);
      expect(paymentService.listAgentPayments).toHaveBeenCalledWith("agent-1", expect.anything());
    });
  });

  describe("admin reads", () => {
    it("GET /admin/payments returns 200 and forwards filters", async () => {
      vi.mocked(paymentService.listAdminPayments).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);

      const res = await call("get", `/api/v1/admin/payments?bookingId=${BOOKING_ID}&method=CASH`, "admin");

      expect(res.status).toBe(200);
      expect(paymentService.listAdminPayments).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: BOOKING_ID, method: "CASH" }),
      );
    });

    it("GET /admin/payments/:paymentId returns 200", async () => {
      vi.mocked(paymentService.getAdminPayment).mockResolvedValue({ id: PAYMENT_ID } as any);
      const res = await call("get", `/api/v1/admin/payments/${PAYMENT_ID}`, "admin");
      expect(res.status).toBe(200);
    });

    it("GET /admin/payments/:paymentId returns 400 for an invalid ID", async () => {
      const res = await call("get", "/api/v1/admin/payments/not-a-uuid", "admin");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/admin/payments/:paymentId/verify", () => {
    it("returns 200 and the verified message", async () => {
      vi.mocked(paymentService.verifyPayment).mockResolvedValue({ id: PAYMENT_ID, status: "VERIFIED" } as any);

      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/verify`, "admin", { decision: "VERIFIED" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Payment verified successfully");
      expect(paymentService.verifyPayment).toHaveBeenCalledWith(
        "admin-1",
        PAYMENT_ID,
        expect.objectContaining({ decision: "VERIFIED" }),
      );
    });

    it("returns 200 and the rejected message", async () => {
      vi.mocked(paymentService.verifyPayment).mockResolvedValue({ id: PAYMENT_ID, status: "REJECTED" } as any);

      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/verify`, "admin", {
        decision: "REJECTED",
        notes: "Reference not found",
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Payment rejected successfully");
    });

    it.each([
      ["missing decision", {}],
      ["invalid decision", { decision: "MAYBE" }],
      ["rejection without notes", { decision: "REJECTED" }],
    ])("returns 400 for %s", async (_label, body) => {
      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/verify`, "admin", body);
      expect(res.status).toBe(400);
      expect(paymentService.verifyPayment).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid payment ID", async () => {
      const res = await call("post", "/api/v1/admin/payments/not-a-uuid/verify", "admin", { decision: "VERIFIED" });
      expect(res.status).toBe(400);
    });

    it("passes service errors through with their status code", async () => {
      vi.mocked(paymentService.verifyPayment).mockRejectedValue(
        new AppError("Only a payment with a submitted receipt can be verified", 409),
      );
      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/verify`, "admin", { decision: "VERIFIED" });
      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/v1/admin/payments/:paymentId/record", () => {
    it("returns 200 with an empty body", async () => {
      vi.mocked(paymentService.recordPayment).mockResolvedValue({ id: PAYMENT_ID, status: "VERIFIED" } as any);

      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/record`, "admin", {});

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Payment recorded successfully");
      expect(paymentService.recordPayment).toHaveBeenCalledWith("admin-1", PAYMENT_ID, expect.anything());
    });

    it("returns 200 with reference, date and notes", async () => {
      vi.mocked(paymentService.recordPayment).mockResolvedValue({ id: PAYMENT_ID, status: "VERIFIED" } as any);

      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/record`, "admin", {
        reference: "RCPT-9",
        receivedAt: "2026-10-20T10:00:00.000Z",
        notes: "Cash at office",
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 for an invalid received date", async () => {
      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/record`, "admin", { receivedAt: "not-a-date" });
      expect(res.status).toBe(400);
      expect(paymentService.recordPayment).not.toHaveBeenCalled();
    });

    it("passes service errors through with their status code", async () => {
      vi.mocked(paymentService.recordPayment).mockRejectedValue(
        new AppError("Only an initiated payment can be recorded. Use verify for submitted receipts.", 409),
      );
      const res = await call("post", `/api/v1/admin/payments/${PAYMENT_ID}/record`, "admin", {});
      expect(res.status).toBe(409);
    });
  });
});