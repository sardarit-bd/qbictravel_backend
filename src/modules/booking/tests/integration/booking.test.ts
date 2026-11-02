import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import * as bookingService from "../../bookingService.js";

vi.mock("../../bookingService.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-mock-role"] as string;
    req.user = { 
      id: role === "admin" ? "admin-1" : role === "agent" ? "agent-1" : "cust-1", 
      role 
    };
    next();
  },
}));

describe("Booking API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Use valid UUIDs to pass Yup validation
  const mockCustomerId = "123e4567-e89b-12d3-a456-426614174000";
  const mockServiceId = "123e4567-e89b-12d3-a456-426614174001";
  const mockBookingId = "123e4567-e89b-12d3-a456-426614174002";

  describe("POST /api/v1/bookings (Customer)", () => {
    it("should return 201 and create booking", async () => {
      const mockBooking = { id: mockBookingId, status: "PENDING", finalPrice: 100 };
      vi.mocked(bookingService.createBooking).mockResolvedValue(mockBooking as any);

      const res = await request(app)
        .post("/api/v1/bookings")
        .set("x-mock-role", "customer")
        .send({ customerId: mockCustomerId, serviceId: mockServiceId });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("PENDING");
    });

    it("should return 400 if required fields are missing", async () => {
      const res = await request(app)
        .post("/api/v1/bookings")
        .set("x-mock-role", "customer")
        .send({}); // Missing customerId and serviceId

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/agent/bookings (Agent)", () => {
    it("should return 202 if booking requires approval", async () => {
      const mockBooking = { id: mockBookingId, status: "AWAITING_APPROVAL", requiresApproval: true };
      vi.mocked(bookingService.createBooking).mockResolvedValue(mockBooking as any);

      const res = await request(app)
        .post("/api/v1/agent/bookings")
        .set("x-mock-role", "agent")
        .send({ customerId: mockCustomerId, serviceId: mockServiceId, proposedPrice: 80 });

      expect(res.status).toBe(202);
      expect(res.body.data.status).toBe("AWAITING_APPROVAL");
    });
  });

  describe("PATCH /api/v1/agent/bookings/:bookingId/price", () => {
    it("should return 200 and update price", async () => {
      const mockBooking = { id: mockBookingId, status: "CONFIRMED", finalPrice: 90 };
      vi.mocked(bookingService.updateAgentBookingPrice).mockResolvedValue(mockBooking as any);

      const res = await request(app)
        .patch(`/api/v1/agent/bookings/${mockBookingId}/price`)
        .set("x-mock-role", "agent")
        .send({ proposedPrice: 90 });

      expect(res.status).toBe(200);
      expect(res.body.data.finalPrice).toBe(90);
    });

    it("should return 400 if proposedPrice is missing", async () => {
      const res = await request(app)
        .patch(`/api/v1/agent/bookings/${mockBookingId}/price`)
        .set("x-mock-role", "agent")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/admin/bookings/:bookingId/price-approvals", () => {
    it("should return 200 and approve price", async () => {
      const mockBooking = { id: mockBookingId, status: "CONFIRMED", finalPrice: 80 };
      vi.mocked(bookingService.reviewBookingPrice).mockResolvedValue(mockBooking as any);

      const res = await request(app)
        .post(`/api/v1/admin/bookings/${mockBookingId}/price-approvals`)
        .set("x-mock-role", "admin")
        .send({ status: "APPROVED", approvedPrice: 80, notes: "Looks good" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CONFIRMED");
    });
  });
});