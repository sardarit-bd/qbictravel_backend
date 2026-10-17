import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_PASSWORD, api, createUser, lastEmailToken, loginAgent, prisma, resetDatabase, tokenFromResponse, } from "../../../../test/helpers.js";
import { sendEmail } from "../../../../shared/utils/mailer.js";
const BASE = "/api/v1/auth";
const REGISTER = `${BASE}/register`;
const LOGIN = `${BASE}/login`;
const LOGOUT = `${BASE}/logout`;
const FORGOT = `${BASE}/forgot-password`;
const RESET = `${BASE}/reset-password`;
const ME = `${BASE}/me`;
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());
describe("POST /auth/register", () => {
    it("creates a customer, sets an httpOnly cookie and hides the password", async () => {
        const res = await api()
            .post(REGISTER)
            .send({ name: "Jane", email: "Jane@Example.com", password: TEST_PASSWORD });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            name: "Jane",
            email: "jane@example.com",
            role: "customer",
        });
        expect(res.body.data.password).toBeUndefined();
        const cookie = [].concat(res.headers["set-cookie"] ?? []).join(";");
        expect(cookie).toMatch(/token=[^;]+;.*HttpOnly/i);
    });
    it("ignores a role sent in the body", async () => {
        const res = await api()
            .post(REGISTER)
            .send({
            name: "Mallory",
            email: "mallory@example.com",
            password: TEST_PASSWORD,
            role: "admin",
        });
        expect(res.status).toBe(201);
        expect(res.body.data.role).toBe("customer");
        const stored = await prisma.user.findUnique({
            where: { email: "mallory@example.com" },
        });
        expect(stored?.role).toBe("customer");
    });
    it("returns 409 for a duplicate email", async () => {
        const existing = await createUser();
        const res = await api()
            .post(REGISTER)
            .send({ name: "Dup", email: existing.email, password: TEST_PASSWORD });
        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
    });
    it.each([
        ["invalid email", { name: "A", email: "nope", password: TEST_PASSWORD }],
        ["short password", { name: "A", email: "a@example.com", password: "123" }],
        ["missing name", { email: "a@example.com", password: TEST_PASSWORD }],
    ])("returns 400 for %s", async (_label, body) => {
        const res = await api().post(REGISTER).send(body);
        expect(res.status).toBe(400);
    });
});
describe("POST /auth/login", () => {
    it("logs in and sets the cookie", async () => {
        const user = await createUser();
        const res = await api()
            .post(LOGIN)
            .send({ email: user.email, password: TEST_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: user.id, role: "customer" });
        expect(tokenFromResponse(res)).toBeTruthy();
    });
    it("returns the same 401 for a wrong password and an unknown email", async () => {
        const user = await createUser();
        const wrong = await api()
            .post(LOGIN)
            .send({ email: user.email, password: "wrong-password" });
        const unknown = await api()
            .post(LOGIN)
            .send({ email: "nobody@example.com", password: TEST_PASSWORD });
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(wrong.body.message).toBe(unknown.body.message);
    });
    it("returns 403 for a deactivated account", async () => {
        const user = await createUser({ status: "deactivated" });
        const res = await api()
            .post(LOGIN)
            .send({ email: user.email, password: TEST_PASSWORD });
        expect(res.status).toBe(403);
    });
    it("returns 400 when fields are missing", async () => {
        const res = await api().post(LOGIN).send({});
        expect(res.status).toBe(400);
    });
});
describe("GET /auth/me", () => {
    it("returns 401 without a token", async () => {
        const res = await api().get(ME);
        expect(res.status).toBe(401);
    });
    it("returns the profile and role using the cookie", async () => {
        const user = await createUser({ role: "agent" });
        const agent = await loginAgent(user.email);
        const res = await agent.get(ME);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            id: user.id,
            email: user.email,
            role: "agent",
            status: "active",
        });
        expect(res.body.data.password).toBeUndefined();
    });
    it("accepts a Bearer token", async () => {
        const user = await createUser();
        const login = await api()
            .post(LOGIN)
            .send({ email: user.email, password: TEST_PASSWORD });
        const res = await api()
            .get(ME)
            .set("Authorization", `Bearer ${tokenFromResponse(login)}`);
        expect(res.status).toBe(200);
    });
    it("returns 401 for a garbage token", async () => {
        const res = await api().get(ME).set("Authorization", "Bearer garbage");
        expect(res.status).toBe(401);
    });
    it("blocks an existing session once the account is deactivated", async () => {
        const user = await createUser();
        const agent = await loginAgent(user.email);
        await prisma.user.update({
            where: { id: user.id },
            data: { status: "deactivated" },
        });
        const res = await agent.get(ME);
        expect(res.status).toBe(403);
    });
});
describe("POST /auth/logout", () => {
    it("returns 401 without a session", async () => {
        const res = await api().post(LOGOUT);
        expect(res.status).toBe(401);
    });
    it("revokes the token so it cannot be reused", async () => {
        const user = await createUser();
        const login = await api()
            .post(LOGIN)
            .send({ email: user.email, password: TEST_PASSWORD });
        const token = tokenFromResponse(login);
        const logout = await api()
            .post(LOGOUT)
            .set("Authorization", `Bearer ${token}`);
        expect(logout.status).toBe(200);
        const reuse = await api().get(ME).set("Authorization", `Bearer ${token}`);
        expect(reuse.status).toBe(401);
    });
});
describe("POST /auth/forgot-password", () => {
    it("gives the same response for known and unknown emails", async () => {
        const user = await createUser();
        const known = await api().post(FORGOT).send({ email: user.email });
        const unknown = await api()
            .post(FORGOT)
            .send({ email: "nobody@example.com" });
        expect(known.status).toBe(200);
        expect(unknown.status).toBe(200);
        expect(known.body).toEqual(unknown.body);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(vi.mocked(sendEmail).mock.calls[0][0].to).toBe(user.email);
    });
    it("sends nothing for a deactivated account but still returns 200", async () => {
        const user = await createUser({ status: "deactivated" });
        const res = await api().post(FORGOT).send({ email: user.email });
        expect(res.status).toBe(200);
        expect(sendEmail).not.toHaveBeenCalled();
    });
    it("returns 400 for an invalid email format", async () => {
        const res = await api().post(FORGOT).send({ email: "nope" });
        expect(res.status).toBe(400);
    });
});
describe("POST /auth/reset-password", () => {
    const NEW_PASSWORD = "newSecret456";
    it("resets the password, invalidates old sessions and burns the token", async () => {
        const user = await createUser();
        const oldLogin = await api()
            .post(LOGIN)
            .send({ email: user.email, password: TEST_PASSWORD });
        const oldToken = tokenFromResponse(oldLogin);
        await api().post(FORGOT).send({ email: user.email });
        const token = lastEmailToken();
        const reset = await api().post(RESET).send({ token, password: NEW_PASSWORD });
        expect(reset.status).toBe(200);
        const newLogin = await api()
            .post(LOGIN)
            .send({ email: user.email, password: NEW_PASSWORD });
        expect(newLogin.status).toBe(200);
        const oldPasswordLogin = await api()
            .post(LOGIN)
            .send({ email: user.email, password: TEST_PASSWORD });
        expect(oldPasswordLogin.status).toBe(401);
        const oldSession = await api()
            .get(ME)
            .set("Authorization", `Bearer ${oldToken}`);
        expect(oldSession.status).toBe(401);
        const reuse = await api().post(RESET).send({ token, password: NEW_PASSWORD });
        expect(reuse.status).toBe(400);
    });
    it("returns 400 for an unknown token", async () => {
        const res = await api()
            .post(RESET)
            .send({ token: "a".repeat(64), password: NEW_PASSWORD });
        expect(res.status).toBe(400);
    });
    it("returns 400 for an expired token", async () => {
        const user = await createUser();
        await api().post(FORGOT).send({ email: user.email });
        const token = lastEmailToken();
        await prisma.passwordResetToken.updateMany({
            data: { expiresAt: new Date(Date.now() - 1000) },
        });
        const res = await api().post(RESET).send({ token, password: NEW_PASSWORD });
        expect(res.status).toBe(400);
    });
    it("returns 400 when the account was deactivated after the request", async () => {
        const user = await createUser();
        await api().post(FORGOT).send({ email: user.email });
        const token = lastEmailToken();
        await prisma.user.update({
            where: { id: user.id },
            data: { status: "deactivated" },
        });
        const res = await api().post(RESET).send({ token, password: NEW_PASSWORD });
        expect(res.status).toBe(400);
    });
    it("returns 400 for a too-short new password", async () => {
        const res = await api()
            .post(RESET)
            .send({ token: "a".repeat(64), password: "123" });
        expect(res.status).toBe(400);
    });
});
