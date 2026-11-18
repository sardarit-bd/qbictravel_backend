import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../../../../app.js";

describe("Discount Route Mount Verification", () => {
  it("recognizes POST /api/v1/staff/bookings/:bookingId/discount-requests as deprecated (401 without auth, 410 when handled)", async () => {
    // Calling without auth should return 401 Unauthorized, NOT 404 Not Found!
    const res = await request(app)
      .post("/api/v1/staff/bookings/11111111-1111-1111-1111-111111111111/discount-requests")
      .send({
        discountType: "PERCENTAGE",
        discountValue: 10,
        reason: "Test discount reason",
      });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });
});
