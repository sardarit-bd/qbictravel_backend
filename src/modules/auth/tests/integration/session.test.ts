import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createUser,
  loginAgent,
  prisma,
  resetDatabase,
  TEST_PASSWORD,
} from "../../../../test/helpers.js";

const REFRESH_BASE = "/api/v1/auth/refresh";
const LOGOUT_ALL_BASE = "/api/v1/auth/logout-all";
const LOGOUT_BASE = "/api/v1/auth/logout";
const ME_BASE = "/api/v1/auth/me";

describe("Dual-Token & Session Management Integration Tests", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("POST /auth/login returns short-lived accessToken and sets pt_refresh cookie", async () => {
    const user = await createUser({ role: "customer" });

    const res = await api().post("/api/v1/auth/login").send({
      email: user.email,
      password: TEST_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(typeof res.body.data.accessToken).toBe("string");

    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies).toBeDefined();
    const refreshCookie = cookies.find((c: string) => c.startsWith("pt_refresh="));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain("HttpOnly");
    expect(refreshCookie).toContain("Path=/api/v1/auth");

    // Also check session table in DB
    const session = await prisma.session.findFirst({
      where: { userId: user.id },
      include: { refreshTokens: true },
    });
    expect(session).toBeDefined();
    expect(session?.revokedAt).toBeNull();
    expect(session?.refreshTokens.length).toBe(1);
    expect(session?.refreshTokens[0].consumedAt).toBeNull();
  });

  it("POST /auth/refresh rotates the refresh token and grants a new accessToken", async () => {
    const user = await createUser({ role: "customer" });

    const loginRes = await api().post("/api/v1/auth/login").send({
      email: user.email,
      password: TEST_PASSWORD,
    });
    const firstCookies = loginRes.headers["set-cookie"] as unknown as string[];
    const firstRefreshCookie = firstCookies.find((c: string) =>
      c.startsWith("pt_refresh=")
    );
    const firstRefreshToken = firstRefreshCookie?.split(";")[0];

    const refreshRes = await api()
      .post(REFRESH_BASE)
      .set("Cookie", [firstRefreshToken!])
      .send();

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.data.accessToken).toBeDefined();

    const secondCookies = refreshRes.headers["set-cookie"] as unknown as string[];
    const secondRefreshCookie = secondCookies.find((c: string) =>
      c.startsWith("pt_refresh=")
    );
    expect(secondRefreshCookie).toBeDefined();

    // The new token should be different
    const secondRefreshToken = secondRefreshCookie?.split(";")[0];
    expect(secondRefreshToken).not.toBe(firstRefreshToken);

    // Verify DB state: first token marked consumed, second token active in same family
    const session = await prisma.session.findFirst({
      where: { userId: user.id },
      include: { refreshTokens: { orderBy: { sequence: "asc" } } },
    });
    expect(session?.refreshTokens.length).toBe(2);
    expect(session?.refreshTokens[0].consumedAt).not.toBeNull();
    expect(session?.refreshTokens[1].consumedAt).toBeNull();
    expect(session?.refreshTokens[0].familyId).toBe(session?.refreshTokens[1].familyId);
  });

  it("Detects reuse of previously consumed refresh token and revokes entire family", async () => {
    const user = await createUser({ role: "customer" });

    const loginRes = await api().post("/api/v1/auth/login").send({
      email: user.email,
      password: TEST_PASSWORD,
    });
    const firstCookies = loginRes.headers["set-cookie"] as unknown as string[];
    const firstRefreshToken = firstCookies
      .find((c: string) => c.startsWith("pt_refresh="))
      ?.split(";")[0];

    // Legitimate refresh 1
    const refreshRes1 = await api()
      .post(REFRESH_BASE)
      .set("Cookie", [firstRefreshToken!])
      .send();
    expect(refreshRes1.status).toBe(200);

    // Attacker tries to reuse the old firstRefreshToken
    const attackRes = await api()
      .post(REFRESH_BASE)
      .set("Cookie", [firstRefreshToken!])
      .send();

    expect(attackRes.status).toBe(401);
    expect(attackRes.body.message).toMatch(/Suspicious session activity|Session revoked/i);

    // Verify session and all tokens in family are revoked
    const session = await prisma.session.findFirst({
      where: { userId: user.id },
      include: { refreshTokens: true },
    });
    expect(session?.revokedAt).not.toBeNull();
    expect(session?.refreshTokens.every((t) => t.revokedAt !== null)).toBe(true);

    // Now even the second token cannot refresh
    const secondRefreshCookie = (
      refreshRes1.headers["set-cookie"] as unknown as string[]
    ).find((c: string) => c.startsWith("pt_refresh="))?.split(";")[0];

    const afterAttackRes = await api()
      .post(REFRESH_BASE)
      .set("Cookie", [secondRefreshCookie!])
      .send();
    expect(afterAttackRes.status).toBe(401);
  });

  it("Supports independent sessions across Browser A and Browser B", async () => {
    const user = await createUser({ role: "staff" });

    // Browser A logs in
    const resA = await api()
      .post("/api/v1/auth/login")
      .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")
      .send({ email: user.email, password: TEST_PASSWORD });
    const cookieA = (resA.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("pt_refresh=")
    )?.split(";")[0];

    // Browser B logs in
    const resB = await api()
      .post("/api/v1/auth/login")
      .set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")
      .send({ email: user.email, password: TEST_PASSWORD });
    const cookieB = (resB.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("pt_refresh=")
    )?.split(";")[0];

    expect(cookieA).not.toBe(cookieB);

    // Check 2 active sessions in database
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(sessions.length).toBe(2);

    // Browser A logs out current session
    const logoutResA = await api()
      .post(LOGOUT_BASE)
      .set("Cookie", [cookieA!])
      .set("Authorization", `Bearer ${resA.body.data.accessToken}`)
      .send();
    expect(logoutResA.status).toBe(200);

    // Browser A refresh fails
    const refreshA = await api().post(REFRESH_BASE).set("Cookie", [cookieA!]).send();
    expect(refreshA.status).toBe(401);

    // Browser B is completely unaffected and can refresh successfully
    const refreshB = await api().post(REFRESH_BASE).set("Cookie", [cookieB!]).send();
    expect(refreshB.status).toBe(200);
    expect(refreshB.body.data.accessToken).toBeDefined();
  });

  it("POST /auth/logout-all revokes all active sessions for the user", async () => {
    const user = await createUser({ role: "admin" });

    // Session 1
    const res1 = await api()
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    const cookie1 = (res1.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("pt_refresh=")
    )?.split(";")[0];
    const token1 = res1.body.data.accessToken;

    // Session 2
    const res2 = await api()
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    const cookie2 = (res2.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith("pt_refresh=")
    )?.split(";")[0];

    // Call logout-all using Session 1
    const logoutAllRes = await api()
      .post(LOGOUT_ALL_BASE)
      .set("Authorization", `Bearer ${token1}`)
      .send();
    expect(logoutAllRes.status).toBe(200);
    expect(logoutAllRes.body.success).toBe(true);

    // Both sessions in DB should be revoked
    const activeSessions = await prisma.session.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(activeSessions.length).toBe(0);

    // Refresh on both sessions fails
    const refresh1 = await api().post(REFRESH_BASE).set("Cookie", [cookie1!]).send();
    expect(refresh1.status).toBe(401);

    const refresh2 = await api().post(REFRESH_BASE).set("Cookie", [cookie2!]).send();
    expect(refresh2.status).toBe(401);

    // Even access tokens are rejected because session is inactive
    const meRes = await api().get(ME_BASE).set("Authorization", `Bearer ${token1}`);
    expect(meRes.status).toBe(401);
  });
});
