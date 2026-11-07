import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";

describe("CORS Configuration Integration Tests", () => {
  const allowedOrigin = "http://72.61.112.137";
  const disallowedOrigin = "http://malicious-site.com";

  describe("Preflight OPTIONS requests", () => {
    it("handles preflight for /api/v1/auth/me from production frontend origin", async () => {
      const res = await request(app)
        .options("/api/v1/auth/me")
        .set("Origin", allowedOrigin)
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "Content-Type,Authorization");

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      expect(res.headers["access-control-allow-methods"]).toContain("GET");
      expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
      expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
    });

    it("handles preflight for /api/v1/auth/register from production frontend origin", async () => {
      const res = await request(app)
        .options("/api/v1/auth/register")
        .set("Origin", allowedOrigin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "Content-Type,Authorization");

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
    });

    it("does not return access-control-allow-origin for unauthorized origin", async () => {
      const res = await request(app)
        .options("/api/v1/auth/me")
        .set("Origin", disallowedOrigin)
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "Content-Type,Authorization");

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("Actual HTTP Requests with Origin Header", () => {
    it("includes CORS headers on /api/v1/auth/me (even when unauthenticated 401)", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Origin", allowedOrigin);

      expect(res.status).toBe(401);
      expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("does not set access-control-allow-origin on /api/v1/auth/me for unauthorized origin", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Origin", disallowedOrigin);

      expect(res.status).toBe(401);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("includes CORS headers on /api/v1/auth/register on validation error (400)", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .set("Origin", allowedOrigin)
        .send({});

      expect(res.status).toBe(400);
      expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("includes CORS headers on rate-limited 429 responses", async () => {
      const express = (await import("express")).default;
      const rateLimit = (await import("express-rate-limit")).default;
      const cors = (await import("cors")).default;

      // Create a test app simulating app.ts middleware order: CORS first, then Rate Limiter
      const testApp = express();
      testApp.use(
        cors({
          origin: [allowedOrigin],
          credentials: true,
        }),
      );
      testApp.use(
        rateLimit({
          windowMs: 60 * 1000,
          max: 1,
          skip: (req) => req.method === "OPTIONS",
        }),
      );
      testApp.get("/api/v1/test-limit", (req, res) => res.json({ success: true }));

      // Request 1: 200 OK with CORS
      const res1 = await request(testApp)
        .get("/api/v1/test-limit")
        .set("Origin", allowedOrigin);
      expect(res1.status).toBe(200);
      expect(res1.headers["access-control-allow-origin"]).toBe(allowedOrigin);

      // Request 2: 429 Too Many Requests with CORS headers preserved
      const res2 = await request(testApp)
        .get("/api/v1/test-limit")
        .set("Origin", allowedOrigin);
      expect(res2.status).toBe(429);
      expect(res2.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(res2.headers["access-control-allow-credentials"]).toBe("true");

      // OPTIONS preflight should still work and bypass rate limit
      const resOptions = await request(testApp)
        .options("/api/v1/test-limit")
        .set("Origin", allowedOrigin)
        .set("Access-Control-Request-Method", "GET");
      expect(resOptions.status).toBe(204);
      expect(resOptions.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    });
  });
});
