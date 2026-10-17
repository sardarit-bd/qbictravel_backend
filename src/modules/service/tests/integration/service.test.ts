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
  });
});