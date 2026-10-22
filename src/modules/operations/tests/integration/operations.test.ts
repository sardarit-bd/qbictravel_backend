import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import AppError from "../../../../shared/utils/AppError.js";
import * as operationsService from "../../operationsService.js";

vi.mock("../../operationsService.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-mock-role"] as string;
    req.user = { id: `${role}-1`, role };
    next();
  },
}));

const BOOKING_ID = "123e4567-e89b-12d3-a456-426614174002";
const STAFF_ID = "123e4567-e89b-12d3-a456-426614174004";

const call = (method: "get" | "post" | "patch", path: string, role: string, body?: object) => {
  const req = request(app)[method](path).set("x-mock-role", role);
  return body ? req.send(body) : req;
};

describe("Operations API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("role guards", () => {
    it.each([
      ["get", "/api/v1/staff/operations/bookings", "admin"],
      ["get", "/api/v1/staff/operations/bookings", "customer"],
      ["get", `/api/v1/staff/operations/bookings/${BOOKING_ID}`, "agent"],
      ["patch", `/api/v1/staff/operations/bookings/${BOOKING_ID}/status`, "admin"],
      ["get", "/api/v1/admin/operations/bookings", "staff"],
      ["patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/assignment`, "staff"],
      ["patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/status`, "staff"],
      ["patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/status`, "customer"],
    ] as const)("%s %s returns 403 for %s", async (method, path, role) => {
      const res = await call(
        method,
        path,
        role,
        method === "patch" ? { fulfillmentStatus: "IN_PROGRESS", notes: "note", staffId: null } : undefined,
      );
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe("staff routes", () => {
    it("GET /staff/operations/bookings returns 200 and forwards the query", async () => {
      vi.mocked(operationsService.listStaffBookings).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);

      const res = await call("get", "/api/v1/staff/operations/bookings?fulfillmentStatus=IN_PROGRESS", "staff");

      expect(res.status).toBe(200);
      expect(operationsService.listStaffBookings).toHaveBeenCalledWith(
        "staff-1",
        expect.objectContaining({ fulfillmentStatus: "IN_PROGRESS" }),
      );
    });

    it("GET /staff/operations/bookings/:bookingId returns 200", async () => {
      vi.mocked(operationsService.getStaffBooking).mockResolvedValue({ id: BOOKING_ID } as any);

      const res = await call("get", `/api/v1/staff/operations/bookings/${BOOKING_ID}`, "staff");

      expect(res.status).toBe(200);
      expect(operationsService.getStaffBooking).toHaveBeenCalledWith("staff-1", BOOKING_ID);
    });

    it("GET /staff/operations/bookings/:bookingId returns 400 for an invalid ID", async () => {
      const res = await call("get", "/api/v1/staff/operations/bookings/not-a-uuid", "staff");
      expect(res.status).toBe(400);
    });

    it("GET /staff/operations/bookings/:bookingId passes a 404 through", async () => {
      vi.mocked(operationsService.getStaffBooking).mockRejectedValue(new AppError("Booking not found", 404));
      const res = await call("get", `/api/v1/staff/operations/bookings/${BOOKING_ID}`, "staff");
      expect(res.status).toBe(404);
    });

    it("PATCH status returns 200 and calls the service as staff", async () => {
      vi.mocked(operationsService.updateOperationalStatus).mockResolvedValue({ id: BOOKING_ID } as any);

      const res = await call("patch", `/api/v1/staff/operations/bookings/${BOOKING_ID}/status`, "staff", {
        fulfillmentStatus: "IN_PROGRESS",
        notes: "Started",
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Fulfillment status updated successfully");
      expect(operationsService.updateOperationalStatus).toHaveBeenCalledWith(
        "staff",
        "staff-1",
        BOOKING_ID,
        expect.objectContaining({ fulfillmentStatus: "IN_PROGRESS" }),
      );
    });

    it.each([
      ["missing status", {}],
      ["invalid status", { fulfillmentStatus: "DONE" }],
      ["too long notes", { fulfillmentStatus: "IN_PROGRESS", notes: "x".repeat(501) }],
    ])("PATCH status returns 400 for %s", async (_label, body) => {
      const res = await call("patch", `/api/v1/staff/operations/bookings/${BOOKING_ID}/status`, "staff", body);
      expect(res.status).toBe(400);
      expect(operationsService.updateOperationalStatus).not.toHaveBeenCalled();
    });

    it.each([403, 404, 409])("PATCH status passes a %i from the service through", async (statusCode) => {
      vi.mocked(operationsService.updateOperationalStatus).mockRejectedValue(new AppError("Not allowed", statusCode));

      const res = await call("patch", `/api/v1/staff/operations/bookings/${BOOKING_ID}/status`, "staff", {
        fulfillmentStatus: "FULFILLED",
      });

      expect(res.status).toBe(statusCode);
      expect(res.body.success).toBe(false);
    });
  });

  describe("admin routes", () => {
    it("GET /admin/operations/bookings returns 200 and forwards filters", async () => {
      vi.mocked(operationsService.listAdminBookings).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 } as any);

      const res = await call("get", `/api/v1/admin/operations/bookings?assignedStaffId=${STAFF_ID}`, "admin");

      expect(res.status).toBe(200);
      expect(operationsService.listAdminBookings).toHaveBeenCalledWith(
        expect.objectContaining({ assignedStaffId: STAFF_ID }),
      );
    });

    it("PATCH assignment returns 200 when assigning a staff member", async () => {
      vi.mocked(operationsService.assignBooking).mockResolvedValue({ id: BOOKING_ID } as any);

      const res = await call("patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/assignment`, "admin", {
        staffId: STAFF_ID,
        notes: "Handover",
      });

      expect(res.status).toBe(200);
      expect(operationsService.assignBooking).toHaveBeenCalledWith(
        "admin-1",
        BOOKING_ID,
        expect.objectContaining({ staffId: STAFF_ID }),
      );
    });

    it("PATCH assignment returns 200 when unassigning with null", async () => {
      vi.mocked(operationsService.assignBooking).mockResolvedValue({ id: BOOKING_ID } as any);

      const res = await call("patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/assignment`, "admin", {
        staffId: null,
      });

      expect(res.status).toBe(200);
      expect(operationsService.assignBooking).toHaveBeenCalledWith(
        "admin-1",
        BOOKING_ID,
        expect.objectContaining({ staffId: null }),
      );
    });

    it.each([
      ["missing staffId", {}],
      ["invalid staffId", { staffId: "not-a-uuid" }],
    ])("PATCH assignment returns 400 for %s", async (_label, body) => {
      const res = await call("patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/assignment`, "admin", body);
      expect(res.status).toBe(400);
      expect(operationsService.assignBooking).not.toHaveBeenCalled();
    });

    it("PATCH assignment passes a 409 through", async () => {
      vi.mocked(operationsService.assignBooking).mockRejectedValue(
        new AppError("This booking can no longer be reassigned", 409),
      );
      const res = await call("patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/assignment`, "admin", {
        staffId: STAFF_ID,
      });
      expect(res.status).toBe(409);
    });

    it("PATCH status returns 200 and calls the service as admin", async () => {
      vi.mocked(operationsService.updateOperationalStatus).mockResolvedValue({ id: BOOKING_ID } as any);

      const res = await call("patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/status`, "admin", {
        fulfillmentStatus: "IN_PROGRESS",
        notes: "Marked complete by mistake",
      });

      expect(res.status).toBe(200);
      expect(operationsService.updateOperationalStatus).toHaveBeenCalledWith(
        "admin",
        "admin-1",
        BOOKING_ID,
        expect.objectContaining({ fulfillmentStatus: "IN_PROGRESS" }),
      );
    });

    it.each([
      ["missing notes", { fulfillmentStatus: "IN_PROGRESS" }],
      ["too short notes", { fulfillmentStatus: "IN_PROGRESS", notes: "ab" }],
      ["missing status", { notes: "Correction" }],
      ["invalid status", { fulfillmentStatus: "DONE", notes: "Correction" }],
    ])("PATCH status returns 400 for %s", async (_label, body) => {
      const res = await call("patch", `/api/v1/admin/operations/bookings/${BOOKING_ID}/status`, "admin", body);
      expect(res.status).toBe(400);
      expect(operationsService.updateOperationalStatus).not.toHaveBeenCalled();
    });

    it("PATCH status returns 400 for an invalid booking ID", async () => {
      const res = await call("patch", "/api/v1/admin/operations/bookings/not-a-uuid/status", "admin", {
        fulfillmentStatus: "IN_PROGRESS",
        notes: "Correction",
      });
      expect(res.status).toBe(400);
    });
  });
});