import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import { dashboardEventHub } from "../../eventHub.js";
import jwt from "jsonwebtoken";
import env from "../../../../config/env.js";
import * as authRepo from "../../../auth/authRepository.js";

describe("GET /api/v1/events/stream SSE Endpoint Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardEventHub.shutdown();
  });

  afterEach(() => {
    dashboardEventHub.shutdown();
  });

  it("rejects unauthenticated requests with HTTP 401", async () => {
    const res = await request(app).get("/api/v1/events/stream");
    expect(res.status).toBe(401);
  });

  it("accepts authenticated requests and sets standard SSE headers", async () => {
    const token = jwt.sign(
      {
        id: "admin-user-1",
        jti: "jti-1",
        tv: 1,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      env.jwtSecret
    );

    vi.spyOn(authRepo, "isTokenRevoked").mockResolvedValue(false);
    vi.spyOn(authRepo, "isSessionActive").mockResolvedValue(true);
    vi.spyOn(authRepo, "findAuthUserById").mockResolvedValue({
      id: "admin-user-1",
      role: "admin",
      status: "active",
      tokenVersion: 1,
    } as any);

    const ssePromise = new Promise<void>((resolve) => {
      const req = request(app)
        .get("/api/v1/events/stream")
        .set("Authorization", `Bearer ${token}`)
        .buffer(false)
        .parse((res, callback) => {
          expect(res.headers["content-type"]).toContain("text/event-stream");
          expect(res.headers["cache-control"]).toContain("no-cache");
          expect(res.headers["connection"]).toBe("keep-alive");

          res.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            if (text.includes(": connected at")) {
              (res as unknown as { destroy: () => void }).destroy();
              resolve();
            }
          });
          callback(null, "");
        });

      req.end(() => {});
    });

    await ssePromise;
  });
});
