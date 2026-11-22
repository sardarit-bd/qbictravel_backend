import { describe, it, expect, vi, beforeEach } from "vitest";
import {
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

describe("Default Staff Permissions Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("permissionConstants", () => {
    it("defines DEFAULT_STAFF_PERMISSIONS containing only booking operational permissions", () => {
      expect(DEFAULT_STAFF_PERMISSIONS).toEqual([
        "bookings.view",
        "bookings.create",
        "bookings.update_status",
        "tours.view",
        "payments.view",
        "payments.record",
      ]);
    });

    it("ensures every default staff permission is in SUPPORTED_PERMISSION_IDS_SET", () => {
      for (const perm of DEFAULT_STAFF_PERMISSIONS) {
        expect(SUPPORTED_PERMISSION_IDS_SET.has(perm)).toBe(true);
      }
    });

    it("does not include admin-only, user management, or sensitive settings permissions in defaults", () => {
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
        expect((DEFAULT_STAFF_PERMISSIONS as readonly string[]).includes(perm)).toBe(false);
      }
    });
  });

  describe("assignStaffDefaultPermissions repository method", () => {
    it("idempotently seeds permissions and creates staffPermission rows with skipDuplicates", async () => {
      vi.mocked(prisma.staffPermission.createMany).mockResolvedValue({ count: DEFAULT_STAFF_PERMISSIONS.length });
      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue(
        DEFAULT_STAFF_PERMISSIONS.map((permissionId) => ({ permissionId })) as any
      );

      const result = await permissionRepo.assignStaffDefaultPermissions("staff-uuid-1");

      expect(prisma.staffPermission.createMany).toHaveBeenCalledWith({
        data: DEFAULT_STAFF_PERMISSIONS.map((pId) => ({
          userId: "staff-uuid-1",
          permissionId: pId,
          assignedById: null,
        })),
        skipDuplicates: true,
      });

      expect(result).toEqual([...DEFAULT_STAFF_PERMISSIONS]);
    });
  });

  describe("permissionService backward-compatible default fallback", () => {
    it("provisions defaults for a staff member with 0 existing permissions in getStaffPermissions", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "staff-uuid-2",
        name: "Legacy Staff",
        email: "staff@example.com",
        role: "staff",
      } as any);

      // First query returns empty (0 assigned)
      vi.mocked(prisma.staffPermission.findMany)
        .mockResolvedValueOnce([]) // for getStaffAssignedPermissions
        .mockResolvedValueOnce(DEFAULT_STAFF_PERMISSIONS.map((permissionId) => ({ permissionId })) as any); // inside assignStaffDefaultPermissions

      vi.mocked(prisma.staffPermission.createMany).mockResolvedValue({ count: DEFAULT_STAFF_PERMISSIONS.length });

      const res = await permissionService.getStaffPermissions("staff-uuid-2");

      expect(res.permissions).toEqual([...DEFAULT_STAFF_PERMISSIONS]);
      expect(prisma.staffPermission.createMany).toHaveBeenCalled();
    });

    it("preserves custom admin permissions and does not overwrite existing staff permissions", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "staff-uuid-3",
        name: "Custom Staff",
        email: "custom@example.com",
        role: "staff",
      } as any);

      const customPerms = ["bookings.view", "reports.view"];
      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue(
        customPerms.map((permissionId) => ({ permissionId })) as any
      );

      const res = await permissionService.getStaffPermissions("staff-uuid-3");

      expect(res.permissions).toEqual(customPerms);
      expect(prisma.staffPermission.createMany).not.toHaveBeenCalled();
    });

    it("allows admin to update/revoke permissions via updateStaffPermissions without them being re-defaulted", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "staff-uuid-4",
        name: "Staff 4",
        email: "staff4@example.com",
        role: "staff",
      } as any);

      const updatedSelection = ["bookings.view"];
      vi.mocked(prisma.staffPermission.findMany).mockResolvedValue(
        updatedSelection.map((permissionId) => ({ permissionId })) as any
      );

      const res = await permissionService.updateStaffPermissions("admin-1", "staff-uuid-4", updatedSelection);

      expect(res.permissions).toEqual(updatedSelection);
      expect(prisma.staffPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: "staff-uuid-4" } });
    });
  });
});
