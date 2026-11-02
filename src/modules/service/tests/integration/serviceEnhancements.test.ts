import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../../../app.js";
import { db } from "../../../../config/database/index.js";
import env from "../../../../config/env.js";

const generateToken = (id: string, role: "customer" | "admin") => {
  return jwt.sign({ id, role, tv: 0, jti: `test-jti-${id}` }, env.jwtSecret, {
    expiresIn: "1h",
  });
};

describe("Admin Services Enhancement API Integration", () => {
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    const adminUser = await db.user.upsert({
      where: { email: "admin-enhance@test.com" },
      update: {},
      create: {
        name: "Admin Enhance",
        email: "admin-enhance@test.com",
        password: "hashed",
        role: "admin",
      },
    });

    const customerUser = await db.user.upsert({
      where: { email: "customer-enhance@test.com" },
      update: {},
      create: {
        name: "Customer Enhance",
        email: "customer-enhance@test.com",
        password: "hashed",
        role: "customer",
      },
    });

    adminToken = generateToken(adminUser.id, "admin");
    customerToken = generateToken(customerUser.id, "customer");
  });

  beforeEach(async () => {
    await db.servicePricing.deleteMany();
    await db.serviceAvailability.deleteMany();
    await db.service.deleteMany();
  });

  afterAll(async () => {
    await db.servicePricing.deleteMany();
    await db.serviceAvailability.deleteMany();
    await db.service.deleteMany();
    await db.$disconnect();
  });

  // ==========================================
  // Hybrid Fuzzy Search & Relevance Ranking
  // ==========================================
  describe("Hybrid Fuzzy Search", () => {
    beforeEach(async () => {
      // Seed services with varied names, destinations, providers, descriptions
      await db.service.createMany({
        data: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            name: "Phi Phi Speedboat Tour",
            description: "Explore Maya Bay and snorkeling spots",
            type: "TOUR",
            status: "PUBLISHED",
            providerName: "Phuket Island Travels",
            metadata: { destination: "Phi Phi Islands" },
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            name: "James Bond Island Sightseeing",
            description: "Canoeing through limestone sea caves in Phang Nga Bay",
            type: "TOUR",
            status: "PUBLISHED",
            providerName: "Phuket Marine Safaris",
            metadata: { destination: "Phang Nga Bay" },
          },
          {
            id: "33333333-3333-3333-3333-333333333333",
            name: "Phuket Old Town Heritage Walk",
            description: "Cultural historical tour visiting Buddhist temples and local markets",
            type: "TOUR",
            status: "DRAFT",
            providerName: "Heritage Walks Ltd",
            metadata: { destination: "Phuket Town", location: { city: "Phuket" } },
          },
          {
            id: "44444444-4444-4444-4444-444444444444",
            name: "Similan Islands Diving Expedition",
            description: "Crystal clear water with manta rays and vibrant coral reefs",
            type: "TOUR",
            status: "UNPUBLISHED",
            providerName: "Blue Ocean Divers",
            metadata: { destination: "Similan Islands" },
          },
          {
            id: "55555555-5555-5555-5555-555555555555",
            name: "Luxury Catamaran Sunset Cruise",
            description: "Sail to Promthep Cape with dinner and live speedboat transfers",
            type: "TOUR",
            status: "PUBLISHED",
            providerName: "Sunset Yacht Club",
            metadata: { destination: "Promthep Cape" },
          },
        ],
      });
    });

    it("should perform exact name search", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=Phi Phi Speedboat Tour")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items[0].name).toBe("Phi Phi Speedboat Tour");
      expect(res.body.data.items[0].relevanceScore).toBeGreaterThan(100);
    });

    it("should perform partial search", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=Catamaran")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].name).toBe("Luxury Catamaran Sunset Cruise");
    });

    it("should perform case-insensitive search", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=phi phi")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.some((i: any) => i.name.includes("Phi Phi"))).toBe(true);
    });

    it("should perform typo-tolerant search via pg_trgm", async () => {
      // "spedboat" is a typo of "Speedboat"
      const res = await request(app)
        .get("/api/v1/admin/services?search=spedboat")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      // The tour with "Speedboat" in name should be returned
      const matched = res.body.data.items.find((i: any) => i.name === "Phi Phi Speedboat Tour");
      expect(matched).toBeDefined();
    });

    it("should perform multi-word search matching across name and description", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=James Bond Phang Nga")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items[0].name).toBe("James Bond Island Sightseeing");
    });

    it("should search destination within JSON metadata", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=Similan Islands")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items[0].name).toBe("Similan Islands Diving Expedition");
    });

    it("should search provider name", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=Blue Ocean Divers")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items[0].providerName).toBe("Blue Ocean Divers");
    });

    it("should rank exact matches above partial matches", async () => {
      // "Phi Phi Speedboat Tour" has "Speedboat" in title (high priority)
      // "Luxury Catamaran Sunset Cruise" has "speedboat" only in description (lower priority)
      const res = await request(app)
        .get("/api/v1/admin/services?search=Speedboat")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.items[0].name).toBe("Phi Phi Speedboat Tour");
      expect(res.body.data.items[0].relevanceScore).toBeGreaterThan(
        res.body.data.items[1].relevanceScore
      );
    });

    it("should return empty list when no records match search query", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=xyzcompletelynonexistent123")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(0);
      expect(res.body.data.pagination.total).toBe(0);
    });
  });

  // ==========================================
  // Status Filtering
  // ==========================================
  describe("Status Filtering", () => {
    beforeEach(async () => {
      await db.service.createMany({
        data: [
          { name: "Draft Item", type: "TOUR", status: "DRAFT" },
          { name: "Published Item 1", type: "TOUR", status: "PUBLISHED" },
          { name: "Published Item 2", type: "TOUR", status: "PUBLISHED" },
          { name: "Unpublished Item", type: "TOUR", status: "UNPUBLISHED" },
        ],
      });
    });

    it("should filter by DRAFT status", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?status=DRAFT")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].status).toBe("DRAFT");
      expect(res.body.data.pagination.total).toBe(1);
    });

    it("should filter by PUBLISHED status", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?status=PUBLISHED")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.items.every((i: any) => i.status === "PUBLISHED")).toBe(true);
    });

    it("should filter by UNPUBLISHED status", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?status=UNPUBLISHED")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].status).toBe("UNPUBLISHED");
    });

    it("should return 400 for invalid status", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?status=INVALID_STATUS")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // Dynamic Sorting
  // ==========================================
  describe("Dynamic Sorting", () => {
    beforeEach(async () => {
      await db.service.createMany({
        data: [
          { name: "Alpha Tour", type: "TOUR", status: "DRAFT" },
          { name: "Zeta Tour", type: "TOUR", status: "PUBLISHED" },
          { name: "Beta Tour", type: "TOUR", status: "UNPUBLISHED" },
        ],
      });
    });

    it("should sort by name ascending", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?sortBy=name&sortOrder=asc")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const names = res.body.data.items.map((i: any) => i.name);
      expect(names).toEqual(["Alpha Tour", "Beta Tour", "Zeta Tour"]);
    });

    it("should sort by name descending", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?sortBy=name&sortOrder=desc")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const names = res.body.data.items.map((i: any) => i.name);
      expect(names).toEqual(["Zeta Tour", "Beta Tour", "Alpha Tour"]);
    });

    it("should sort by status ascending", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?sortBy=status&sortOrder=asc")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(3);
    });

    it("should return 400 for unauthorized sort field", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?sortBy=maliciousColumn")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ==========================================
  // Pagination Combined with Search & Filter
  // ==========================================
  describe("Pagination", () => {
    beforeEach(async () => {
      const tours = Array.from({ length: 7 }, (_, i) => ({
        name: `Island Cruise ${i + 1}`,
        type: "TOUR" as const,
        status: "PUBLISHED" as const,
      }));
      await db.service.createMany({ data: tours });
    });

    it("should paginate correctly with limit and page", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?limit=3&page=2")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(3);
      expect(res.body.data.pagination.page).toBe(2);
      expect(res.body.data.pagination.limit).toBe(3);
      expect(res.body.data.pagination.total).toBe(7);
      expect(res.body.data.pagination.totalPages).toBe(3);
    });

    it("should paginate with search and filters combined", async () => {
      const res = await request(app)
        .get("/api/v1/admin/services?search=Cruise&status=PUBLISHED&limit=2&page=1")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.pagination.total).toBe(7);
      expect(res.body.data.pagination.totalPages).toBe(4);
    });
  });

  // ==========================================
  // Pricing and Availability Summaries
  // ==========================================
  describe("Pricing & Availability Summaries", () => {
    it("should return null summaries when no records exist", async () => {
      await db.service.create({
        data: { name: "No Price Tour", type: "TOUR", status: "DRAFT" },
      });

      const res = await request(app)
        .get("/api/v1/admin/services")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].pricingSummary).toBeNull();
      expect(res.body.data.items[0].availabilitySummary).toBeNull();
    });

    it("should return correct pricing and availability summary when configured", async () => {
      const service = await db.service.create({
        data: { name: "Configured Tour", type: "TOUR", status: "PUBLISHED" },
      });

      // Add pricing
      await db.servicePricing.create({
        data: {
          serviceId: service.id,
          currency: "USD",
          basePrice: 150.0,
          discountedPrice: 120.0,
          taxRate: 7.0,
          validFrom: new Date("2026-01-01"),
          validTo: new Date("2026-12-31"),
        },
      });

      // Add availability (2 available dates, 1 unavailable)
      await db.serviceAvailability.createMany({
        data: [
          {
            serviceId: service.id,
            date: new Date("2026-06-01"),
            isAvailable: true,
            capacity: 25,
            bookedCount: 5,
          },
          {
            serviceId: service.id,
            date: new Date("2026-06-02"),
            isAvailable: true,
            capacity: 25,
            bookedCount: 10,
          },
          {
            serviceId: service.id,
            date: new Date("2026-06-03"),
            isAvailable: false,
            capacity: 25,
            bookedCount: 0,
          },
        ],
      });

      const res = await request(app)
        .get("/api/v1/admin/services")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const item = res.body.data.items[0];

      // Pricing Summary verification
      expect(item.pricingSummary).toBeDefined();
      expect(item.pricingSummary.currency).toBe("USD");
      expect(item.pricingSummary.basePrice).toBe(150);
      expect(item.pricingSummary.discountedPrice).toBe(120);
      expect(item.pricingSummary.taxRate).toBe(7);

      // Availability Summary verification
      expect(item.availabilitySummary).toBeDefined();
      expect(item.availabilitySummary.availableDateCount).toBe(2);
      expect(item.availabilitySummary.unavailableDateCount).toBe(1);
      expect(item.availabilitySummary.totalCapacity).toBe(75);
      expect(item.availabilitySummary.bookedCount).toBe(15);
    });
  });

  // ==========================================
  // Bulk Status Update
  // ==========================================
  describe("Bulk Status Update", () => {
    let service1Id: string;
    let service2Id: string;

    beforeEach(async () => {
      const s1 = await db.service.create({
        data: { name: "Bulk Tour 1", type: "TOUR", status: "DRAFT" },
      });
      const s2 = await db.service.create({
        data: { name: "Bulk Tour 2", type: "TOUR", status: "DRAFT" },
      });
      service1Id = s1.id;
      service2Id = s2.id;
    });

    it("should bulk update statuses to PUBLISHED", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/services/bulk-status")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceIds: [service1Id, service2Id],
          status: "PUBLISHED",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.updatedCount).toBe(2);
      expect(res.body.data.requestedCount).toBe(2);
      expect(res.body.data.status).toBe("PUBLISHED");
      expect(res.body.data.notFoundIds.length).toBe(0);

      // Verify in DB
      const updated = await db.service.findMany({
        where: { id: { in: [service1Id, service2Id] } },
      });
      expect(updated.every((s) => s.status === "PUBLISHED")).toBe(true);
    });

    it("should handle missing IDs predictably", async () => {
      const fakeUuid = "a0000000-0000-4000-8000-000000000000";
      const res = await request(app)
        .patch("/api/v1/admin/services/bulk-status")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceIds: [service1Id, fakeUuid],
          status: "UNPUBLISHED",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.updatedCount).toBe(1);
      expect(res.body.data.requestedCount).toBe(2);
      expect(res.body.data.updatedIds).toContain(service1Id);
      expect(res.body.data.notFoundIds).toContain(fakeUuid);

      const s1 = await db.service.findUnique({ where: { id: service1Id } });
      expect(s1?.status).toBe("UNPUBLISHED");
    });

    it("should return 400 for empty serviceIds array", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/services/bulk-status")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceIds: [],
          status: "PUBLISHED",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for invalid UUID in serviceIds", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/services/bulk-status")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceIds: ["invalid-uuid-string"],
          status: "PUBLISHED",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for invalid status value", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/services/bulk-status")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          serviceIds: [service1Id],
          status: "INVALID_STATUS",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 401 without token", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/services/bulk-status")
        .send({
          serviceIds: [service1Id],
          status: "PUBLISHED",
        });

      expect(res.status).toBe(401);
    });

    it("should return 403 for non-admin user", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/services/bulk-status")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          serviceIds: [service1Id],
          status: "PUBLISHED",
        });

      expect(res.status).toBe(403);
    });
  });
});
