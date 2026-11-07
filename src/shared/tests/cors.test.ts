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
  });
});
