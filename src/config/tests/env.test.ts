import { describe, expect, it } from "vitest";

describe("env.frontendUrl configuration", () => {
  it("defaults to localhost:3000 when FRONTEND_URL is not provided", async () => {
    const original = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;

    // re-import env dynamically
    const { default: env } = await import("../env.js?case=default");
    expect(env.frontendUrl).toBe("http://localhost:3000");

    process.env.FRONTEND_URL = original;
  });

  it("respects custom production FRONTEND_URL and strips trailing slashes", async () => {
    const original = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "http://72.61.112.137/";

    const { default: env } = await import("../env.js?case=prod-slash");
    expect(env.frontendUrl).toBe("http://72.61.112.137");

    process.env.FRONTEND_URL = original;
  });

  it("handles production IP without trailing slashes", async () => {
    const original = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "http://72.61.112.137";

    const { default: env } = await import("../env.js?case=prod-clean");
    expect(env.frontendUrl).toBe("http://72.61.112.137");

    process.env.FRONTEND_URL = original;
  });
});

