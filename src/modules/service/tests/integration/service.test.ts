import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../../../app.js";
import { db } from "../../../../config/database/index.js";
import env from "../../../../config/env.js";

// Helper to generate a mock JWT for testing
const generateToken = (id: string, role: "customer" | "admin") => {
  return jwt.sign({ id, role, tv: 0, jti: `test-jti-${id}` }, env.jwtSecret, {
    expiresIn: "1h",
  });
};

describe("Service API Integration", () => {
  let adminToken: string;
  let customerToken: string;
  let createdServiceId: string;

  beforeAll(async () => {
    // Create mock users in DB to satisfy authMiddleware if it checks user existence
    const adminUser = await db.user.upsert({
      where: { email: "admin@test.com" },
      update: {},
      create: {
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      },
    });
    
    const customerUser = await db.user.upsert({
      where: { email: "customer@test.com" },
      update: {},
      create: {
        name: "Customer",
        email: "customer@test.com",
        password: "hashed",
        role: "customer",
      },
    });

    adminToken = generateToken(adminUser.id, "admin");
    customerToken = generateToken(customerUser.id, "customer");
  });

  beforeEach(async () => {
    // Clean up services before each test to ensure isolation
    // Order matters due to foreign key constraints (delete children first)
    await db.payment.deleteMany();
    await db.bookingHistory.deleteMany();
    await db.priceApproval.deleteMany();
    await db.booking.deleteMany();
    await db.pricingRule.deleteMany();
    await db.servicePricing.deleteMany();
    await db.serviceAvailability.deleteMany();
    await db.service.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // ==========================================
  // Public Endpoints
  // ==========================================
  describe("Public Endpoints", () => {
    it("GET /api/v1/services - should return empty list initially", async () => {
      const res = await request(app).get("/api/v1/services");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data.items.length).toBe(0);
    });

    it("GET /api/v1/services/:id - should return 404 for non-existent service", async () => {
      const res = await request(app).get("/api/v1/services/non-existent-id");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Service not found");
    });
  });

  // ==========================================
  // Admin Endpoints - Auth & Validation
  // ==========================================
  describe("Admin Endpoints - Auth & Validation", () => {
    it("POST /api/v1/admin/services - should return 401 without token", async () => {
      const res = await request(app)
        .post("/api/v1/admin/services")
        .send({ name: "Test", type: "HOTEL" });

      expect(res.status).toBe(401);
    });

    it("POST /api/v1/admin/services - should return 403 for customer role", async () => {
      const res = await request(app)
        .post("/api/v1/admin/services")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ name: "Test", type: "HOTEL" });

      expect(res.status).toBe(403);
    });

    it("POST /api/v1/admin/services - should return 400 for invalid payload", async () => {
      const res = await request(app)
        .post("/api/v1/admin/services")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "A", type: "INVALID_TYPE" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // Admin Endpoints - Happy Path
  // ==========================================
  describe("Admin Endpoints - Happy Path", () => {
    it("POST /api/v1/admin/services - should create a service", async () => {
      const payload = {
        name: "Grand Hotel",
        type: "HOTEL",
        description: "Luxury",
      };
      const res = await request(app)
        .post("/api/v1/admin/services")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Grand Hotel");
      expect(res.body.data.status).toBe("DRAFT");

      createdServiceId = res.body.data.id;
    });

    it("GET /api/v1/services - should NOT include DRAFT services", async () => {
      await request(app)
        .post("/api/v1/admin/services")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Draft Tour", type: "TOUR" });

      const res = await request(app).get("/api/v1/services");

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(0);
    });

    it("PATCH /api/v1/admin/services/:id/status - should publish the service", async () => {
      const createRes = await request(app)
        .post("/api/v1/admin/services")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "To Publish", type: "PACKAGE" });

      const serviceId = createRes.body.data.id;

      const res = await request(app)
        .patch(`/api/v1/admin/services/${serviceId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "PUBLISHED" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("PUBLISHED");
    });

    it("GET /api/v1/services - should include PUBLISHED services", async () => {
      const createRes = await request(app)
        .post("/api/v1/admin/services")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Visible Tour", type: "TOUR" });

      await request(app)
        .patch(`/api/v1/admin/services/${createRes.body.data.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "PUBLISHED" });

      const res = await request(app).get("/api/v1/services");

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe("Visible Tour");
    });

    // ==========================================
    // DELETE /api/v1/admin/services/:serviceId
    // ==========================================
    describe("DELETE /api/v1/admin/services/:serviceId", () => {
      let staffToken: string;
      let customerId: string;

      beforeAll(async () => {
        const staffUser = await db.user.upsert({
          where: { email: "staff_service_test@test.com" },
          update: {},
          create: {
            name: "Staff User",
            email: "staff_service_test@test.com",
            password: "hashed",
            role: "staff",
          },
        });
        staffToken = jwt.sign(
          { id: staffUser.id, role: "staff", tv: 0, jti: `test-jti-${staffUser.id}` },
          env.jwtSecret,
          { expiresIn: "1h" }
        );

        const customerUser = await db.user.findUnique({
          where: { email: "customer@test.com" },
        });
        customerId = customerUser!.id;
      });

      it("should return 401 without auth token", async () => {
        const res = await request(app).delete("/api/v1/admin/services/00000000-0000-0000-0000-000000000000");
        expect(res.status).toBe(401);
      });

      it("should return 403 for staff role (admin only)", async () => {
        const res = await request(app)
          .delete("/api/v1/admin/services/00000000-0000-0000-0000-000000000000")
          .set("Authorization", `Bearer ${staffToken}`);
        expect(res.status).toBe(403);
      });

      it("should return 400 for invalid UUID format", async () => {
        const res = await request(app)
          .delete("/api/v1/admin/services/invalid-id")
          .set("Authorization", `Bearer ${adminToken}`);
        expect(res.status).toBe(400);
      });

      it("should return 404 for non-existent service", async () => {
        const res = await request(app)
          .delete("/api/v1/admin/services/00000000-0000-0000-0000-000000000000")
          .set("Authorization", `Bearer ${adminToken}`);
        expect(res.status).toBe(404);
      });

      it("should permanently delete a service with no booking history and cascade dependencies", async () => {
        // Create service
        const createRes = await request(app)
          .post("/api/v1/admin/services")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ name: "Deletable Tour", type: "TOUR" });
        const serviceId = createRes.body.data.id;

        // Add pricing and availability
        await db.servicePricing.create({
          data: {
            serviceId,
            currency: "USD",
            basePrice: 150,
          },
        });
        await db.serviceAvailability.create({
          data: {
            serviceId,
            date: new Date("2026-05-01"),
            isAvailable: true,
            capacity: 20,
          },
        });

        // Add direct media relation
        const media = await db.media.create({
          data: {
            assetId: `asset-${serviceId}`,
            publicId: `pub-${serviceId}`,
            secureUrl: "https://example.com/photo.jpg",
            format: "jpg",
            bytes: 1024,
            folder: "phukettours/tours",
            uploadedById: customerId,
            serviceId,
          },
        });

        // Add pricing rule targeted at this service
        await db.pricingRule.create({
          data: {
            name: "Discount Rule",
            type: "AGENT_DISCOUNT_LIMIT",
            value: 10,
            serviceId,
          },
        });

        // Execute delete
        const res = await request(app)
          .delete(`/api/v1/admin/services/${serviceId}`)
          .set("Authorization", `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe(serviceId);

        // Verify service is gone
        const found = await db.service.findUnique({ where: { id: serviceId } });
        expect(found).toBeNull();

        // Verify cascaded availability and pricing
        const availabilities = await db.serviceAvailability.findMany({ where: { serviceId } });
        expect(availabilities.length).toBe(0);
        const pricings = await db.servicePricing.findMany({ where: { serviceId } });
        expect(pricings.length).toBe(0);

        // Verify media was unlinked (not destroyed, serviceId set to null)
        const updatedMedia = await db.media.findUnique({ where: { id: media.id } });
        expect(updatedMedia?.serviceId).toBeNull();

        // Verify pricing rule was cleaned up
        const pricingRules = await db.pricingRule.findMany({ where: { serviceId } });
        expect(pricingRules.length).toBe(0);
      });

      it("should reject deletion if service has booking history", async () => {
        // Create service
        const createRes = await request(app)
          .post("/api/v1/admin/services")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ name: "Booked Tour", type: "TOUR" });
        const serviceId = createRes.body.data.id;

        // Create booking for this service
        await db.booking.create({
          data: {
            customerId,
            serviceId,
            currency: "USD",
            basePrice: 100,
            finalPrice: 100,
            status: "CONFIRMED",
          },
        });

        const res = await request(app)
          .delete(`/api/v1/admin/services/${serviceId}`)
          .set("Authorization", `Bearer ${adminToken}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('Cannot delete tour "Booked Tour" because it has 1 existing booking');

        // Verify service still exists
        const stillExists = await db.service.findUnique({ where: { id: serviceId } });
        expect(stillExists).not.toBeNull();
      });
    });
  });
});