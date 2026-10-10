import { describe, expect, it } from "vitest";
import swaggerSpec from "../swagger.js";

const documented: Array<[string, string]> = [
  ["/api/v1/auth/register", "post"],
  ["/api/v1/auth/login", "post"],
  ["/api/v1/auth/logout", "post"],
  ["/api/v1/auth/forgot-password", "post"],
  ["/api/v1/auth/reset-password", "post"],
  ["/api/v1/auth/me", "get"],
  ["/api/v1/users/me", "get"],
  ["/api/v1/users/me", "patch"],
  ["/api/v1/admin/users", "get"],
  ["/api/v1/admin/users/{userId}", "get"],
  ["/api/v1/admin/users/{userId}", "patch"],
  ["/api/v1/admin/agents", "post"],
  ["/api/v1/admin/agents", "get"],
  ["/api/v1/admin/agents/{agentId}", "get"],
  ["/api/v1/admin/agents/{agentId}", "patch"],
  ["/api/v1/admin/staff", "get"],
  ["/api/v1/admin/staff", "post"],
  ["/api/v1/admin/staff/{staffId}", "patch"],
];

const spec = swaggerSpec as {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

describe("Swagger spec", () => {
  it.each(documented)("documents %s %s", (path, method) => {
    expect(spec.paths[path]?.[method]).toBeDefined();
  });

  it("defines the shared and request schemas", () => {
    for (const name of [
      "ErrorResponse",
      "RegisterRequest",
      "ResetPasswordRequest",
      "UpdateProfileRequest",
      "AdminCreateAgentRequest",
    ]) {
      expect(spec.components.schemas[name]).toBeDefined();
    }
  });
});