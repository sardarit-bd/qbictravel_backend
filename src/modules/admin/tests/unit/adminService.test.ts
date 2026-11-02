import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminRepository from "../../adminRepository.js";
import * as authRepository from "../../../auth/authRepository.js";
import * as authService from "../../../auth/authService.js";
import {
  createAgent,
  getAgent,
  listAgents,
  updateStaff,
  updateUser,
} from "../../adminService.js";
import type { AdminUser } from "../../adminTypes.js";

vi.mock("../../adminRepository.js");
vi.mock("../../../auth/authRepository.js");
vi.mock("../../../auth/authService.js");

const adminRepo = vi.mocked(adminRepository);
const authRepo = vi.mocked(authRepository);
const mail = vi.mocked(authService);

const actor = {
  id: "admin-1",
  name: "Admin",
  email: "admin@example.com",
  role: "admin" as const,
};

const adminUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: "u2",
  name: "Target",
  email: "target@example.com",
  phone: null,
  role: "customer",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
  agentProfile: null,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("updateUser", () => {
  it("blocks an admin from changing their own status", async () => {
    adminRepo.findUserById.mockResolvedValue(adminUser({ id: actor.id }));

    await expect(
      updateUser(actor, actor.id, { status: "deactivated" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(adminRepo.updateUser).not.toHaveBeenCalled();
  });

  it("allows an admin to change their own name", async () => {
    adminRepo.findUserById.mockResolvedValue(adminUser({ id: actor.id }));
    adminRepo.updateUser.mockResolvedValue(adminUser({ id: actor.id }));

    await updateUser(actor, actor.id, { name: "New Name" });

    expect(adminRepo.updateUser).toHaveBeenCalledWith(actor.id, {
      name: "New Name",
    });
  });

  it("returns 404 for an unknown user", async () => {
    adminRepo.findUserById.mockResolvedValue(null);

    await expect(
      updateUser(actor, "missing", { name: "X" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("agents and staff scoping", () => {
  it("getAgent returns 404 when the user is not an agent", async () => {
    adminRepo.findUserById.mockResolvedValue(adminUser({ role: "customer" }));

    await expect(getAgent("u2")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("listAgents always filters by the agent role", async () => {
    adminRepo.listUsers.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await listAgents({ page: 1, limit: 20, role: "admin" });

    expect(adminRepo.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ role: "agent" }),
    );
  });

  it("updateStaff returns 404 when the user is not staff", async () => {
    adminRepo.findUserById.mockResolvedValue(adminUser({ role: "agent" }));

    await expect(
      updateStaff(actor, "u2", { name: "X" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("createAgent", () => {
  it("rejects a duplicate email with 409", async () => {
    authRepo.findUserByEmail.mockResolvedValue({
      id: "u9",
      name: "Existing",
      email: "dup@example.com",
      role: "customer",
      status: "active",
      tokenVersion: 0,
    });

    await expect(
      createAgent({ name: "Agent", email: "dup@example.com" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(adminRepo.createAccount).not.toHaveBeenCalled();
  });

  it("creates the agent with an unusable random password and emails a setup link", async () => {
    authRepo.findUserByEmail.mockResolvedValue(null);
    const created = adminUser({ id: "a1", role: "agent", email: "a@example.com" });
    adminRepo.createAccount.mockResolvedValue(created);

    const result = await createAgent({
      name: "Agent",
      email: "a@example.com",
      agencyName: "Sky Travels",
    });

    const input = adminRepo.createAccount.mock.calls[0]![0];
    expect(input).toMatchObject({
      role: "agent",
      email: "a@example.com",
      agencyName: "Sky Travels",
    });
    expect(input.password).toMatch(/^\$2[aby]\$/);
    expect(mail.sendAccountSetupEmail).toHaveBeenCalledWith(created);
    expect(result).toBe(created);
  });

  it("still succeeds when the setup email fails", async () => {
    authRepo.findUserByEmail.mockResolvedValue(null);
    adminRepo.createAccount.mockResolvedValue(adminUser({ role: "agent" }));
    mail.sendAccountSetupEmail.mockRejectedValue(new Error("smtp down"));

    await expect(
      createAgent({ name: "Agent", email: "a@example.com" }),
    ).resolves.toBeDefined();
  });
});