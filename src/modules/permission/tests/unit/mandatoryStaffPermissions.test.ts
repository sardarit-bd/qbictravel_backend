import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MANDATORY_STAFF_PERMISSIONS,
  MANDATORY_STAFF_PERMISSIONS_SET,
  DEFAULT_STAFF_PERMISSIONS,
  ALL_PERMISSION_IDS,
  SUPPORTED_PERMISSION_IDS_SET,
} from "../../permissionConstants.js";
import * as permissionService from "../../permissionService.js";
import * as permissionRepo from "../../permissionRepository.js";
import { prisma } from "../../../../lib/prisma.js";

vi.mock("../../../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    staffPermission: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
    },
    permission: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

describe("Mandatory Staff Permissions Enforcement Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("permissionConstants - Mandatory Definitions", () => {
    it("defines MANDATORY_STAFF_PERMISSIONS containing all required operational permissions", () => {
      expect(MANDATORY_STAFF_PERMISSIONS).toEqual([
        "bookings.view",
        "bookings.create",
        "bookings.update_status",
        "tours.view",
        "payments.view",
        "payments.record",
      ]);
      expect(DEFAULT_STAFF_PERMISSIONS).toEqual(MANDATORY_STAFF_PERMISSIONS);
    });

    it("ensures every mandatory permission is in SUPPORTED_PERMISSION_IDS_SET", () => {
      for (const perm of MANDATORY_STAFF_PERMISSIONS) {
        expect(SUPPORTED_PERMISSION_IDS_SET.has(perm)).toBe(true);
      }
    });

    it("strictly excludes admin-only and sensitive configuration permissions from mandatory defaults", () => {
      const sensitivePermissions = [
        "users.invite_staff",
        "users.invite_agent",
        "users.deactivate",
        "users.delete",
        "bookings.assign",
        "bookings.approve_price",
        "reports.view",
        "settings.view",
        "settings.general.manage",
        "settings.payment.manage",
        "settings.webhook.manage",
        "settings.cloudinary.manage",
        "settings.smtp.manage",
      ];

      for (const perm of sensitivePermissions) {
        expect(MANDATORY_STAFF_PERMISSIONS_SET.has(perm)).toBe(false);
      }
    });
  });

  describe("Backend Check & Effective Permissions Enforcement", () => {
    it("checkStaffPermission always returns true for mandatory permissions without querying DB", async () => {
      for (const perm of MANDATORY_STAFF_PERMISSIONS) {
        const allowed = await permissionRepo.checkStaffPermission("any-staff-id", perm);
        expect(allowed).toBe(true);
      }
      expect(prisma.staffPermission.count).not.toHaveBeenCalled();
    });

    it("checkStaffPermission queries DB for optional permissions", async () => {
      vi.mocked(prisma.staffPermission.count).mockResolvedValue(1);
      const allowed = await permissionRepo.checkStaffPermission("staff-1", "reports.view");
      expect(allowed).toBe(true);
      expect(prisma.staffPermission.count).toHaveBeenCalledWith({
        where: { userId: "staff-1", permissionId: "reports.view" },
      });
    });

    it("getUserEffectivePermissions always merges mandatory permissions with assigned optional permissions", async () => {
      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue([
        { permissionId: "reports.view" },
      ] as any);

      const effective = await permissionRepo.getUserEffectivePermissions("staff-1", "staff");

      for (const mandatory of MANDATORY_STAFF_PERMISSIONS) {
        expect(effective).toContain(mandatory);
      }
      expect(effective).toContain("reports.view");
    });

    it("getEffectivePermissions service returns all mandatory permissions even if staff has 0 optional assignments", async () => {
      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue([]);

      const result = await permissionService.getEffectivePermissions("staff-1", "staff");

      expect(result.role).toBe("staff");
      expect(result.isAdmin).toBe(false);
      for (const mandatory of MANDATORY_STAFF_PERMISSIONS) {
        expect(result.permissions).toContain(mandatory);
      }
    });
  });

  describe("Admin Permission Management UI & API Isolation", () => {
    it("getPermissionCatalog filters out mandatory permissions so Admin cannot manage them", async () => {
      vi.mocked(prisma.permission.findMany).mockResolvedValue(
        ALL_PERMISSION_IDS.map((id) => ({
          id,
          name: id,
          module: id.split(".")[0],
          description: "",
        })) as any
      );

      const catalog = await permissionService.getPermissionCatalog();

      const allCatalogPermissionIds = catalog.modules.flatMap((m) => m.permissions.map((p) => p.id));
      for (const mandatory of MANDATORY_STAFF_PERMISSIONS) {
        expect(allCatalogPermissionIds).not.toContain(mandatory);
      }
    });

    it("getStaffPermissions returns only optional permissions to the Admin management dialog", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "staff-1",
        name: "Staff User",
        email: "staff@example.com",
        role: "staff",
      } as any);

      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue([
        ...MANDATORY_STAFF_PERMISSIONS.map((p) => ({ permissionId: p })),
        { permissionId: "reports.view" },
      ] as any);

      const res = await permissionService.getStaffPermissions("staff-1");

      expect(res.permissions).toEqual(["reports.view"]);
      for (const mandatory of MANDATORY_STAFF_PERMISSIONS) {
        expect(res.permissions).not.toContain(mandatory);
      }
    });

    it("updateStaffPermissions enforces retention of mandatory permissions even if Admin submits an empty array", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "staff-1",
        name: "Staff User",
        email: "staff@example.com",
        role: "staff",
      } as any);

      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue(
        MANDATORY_STAFF_PERMISSIONS.map((p) => ({ permissionId: p })) as any
      );

      // Admin submits empty array [] attempting to revoke all
      await permissionService.updateStaffPermissions("admin-1", "staff-1", []);

      // Verify that createMany was called with all MANDATORY_STAFF_PERMISSIONS
      expect(prisma.staffPermission.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining(
          MANDATORY_STAFF_PERMISSIONS.map((pId) =>
            expect.objectContaining({ userId: "staff-1", permissionId: pId })
          )
        ),
        skipDuplicates: true,
      });
    });

    it("updateStaffPermissions allows Admin to grant and revoke optional permissions", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "staff-1",
        name: "Staff User",
        email: "staff@example.com",
        role: "staff",
      } as any);

      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue([
        ...MANDATORY_STAFF_PERMISSIONS.map((p) => ({ permissionId: p })),
        { permissionId: "reports.view" },
      ] as any);

      // Admin grants reports.view
      const res = await permissionService.updateStaffPermissions("admin-1", "staff-1", ["reports.view"]);

      expect(res.permissions).toEqual(["reports.view"]);
      expect(prisma.staffPermission.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: "staff-1", permissionId: "reports.view" }),
          ...MANDATORY_STAFF_PERMISSIONS.map((pId) =>
            expect.objectContaining({ userId: "staff-1", permissionId: pId })
          ),
        ]),
        skipDuplicates: true,
      });
    });
  });
});
