import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import { updateServiceRecord } from "../../serviceRepository.js";
import {
  saveDraftRevision,
  validateDraftRevisionData,
  archiveService,
  restoreService,
  setServicePickupAssignments,
} from "../../serviceRevisionService.js";

vi.mock("../../../../lib/prisma.js", () => {
  const tx = {
    service: { findUnique: vi.fn(), update: vi.fn() },
    servicePackage: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    serviceTimeSlot: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    pickupZone: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    booking: { count: vi.fn() },
    servicePickupZoneAssignment: { deleteMany: vi.fn(), upsert: vi.fn() },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (cb: any) => cb(tx)),
      service: { findUnique: vi.fn(), update: vi.fn() },
      serviceDraftRevision: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
      __tx: tx,
    },
  };
});

describe("Simple Product Builder — Phase 1 Foundation", () => {
  const tx = (prisma as any).__tx;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves existing Package IDs and deactivates booking-referenced omitted packages instead of deleting them", async () => {
    tx.service.findUnique.mockResolvedValueOnce({ id: "svc-1", version: 2, metadata: {}, providerName: "Op" });
    tx.service.update.mockResolvedValueOnce({ id: "svc-1", version: 3, providerName: "Op" });
    tx.servicePackage.findMany.mockResolvedValueOnce([{ id: "pkg-keep" }, { id: "pkg-booked" }, { id: "pkg-unused" }]);
    tx.booking.count.mockImplementation(async ({ where }: any) => (where.packageId === "pkg-booked" ? 3 : 0));

    await updateServiceRecord("svc-1", {
      expectedVersion: 2,
      packages: [
        { id: "pkg-keep", name: "Updated Yamaha", durationMinutes: 180, maxCapacity: 2, sellingPrice: 6000 } as any,
        { name: "New Sea-Doo", durationMinutes: 180, maxCapacity: 2, sellingPrice: 7000 } as any,
      ],
    });

    expect(tx.servicePackage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pkg-keep" } })
    );
    expect(tx.servicePackage.create).toHaveBeenCalledTimes(1);
    expect(tx.servicePackage.update).toHaveBeenCalledWith({
      where: { id: "pkg-booked" },
      data: { isActive: false },
    });
    expect(tx.servicePackage.delete).toHaveBeenCalledWith({ where: { id: "pkg-unused" } });
  });

  it("rejects foreign Package IDs that do not belong to the target Service", async () => {
    tx.service.findUnique.mockResolvedValueOnce({ id: "svc-1", version: 1, metadata: {}, providerName: "Op" });
    tx.service.update.mockResolvedValueOnce({ id: "svc-1", version: 2, providerName: "Op" });
    tx.servicePackage.findMany.mockResolvedValueOnce([{ id: "pkg-own" }]);

    await expect(
      updateServiceRecord("svc-1", {
        packages: [{ id: "pkg-foreign", name: "Hijack", durationMinutes: 60, maxCapacity: 2, sellingPrice: 1000 } as any],
      })
    ).rejects.toThrow(/does not belong to this service/i);
  });

  it("rejects stale live Service update with 409 Conflict", async () => {
    tx.service.findUnique.mockResolvedValueOnce({ id: "svc-1", version: 5, metadata: {}, providerName: "Op" });

    await expect(
      updateServiceRecord("svc-1", { name: "Stale Edit", expectedVersion: 4 })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("autosaves Draft Revision without touching live Service and rejects stale revision version with 409", async () => {
    vi.mocked(prisma.serviceDraftRevision.findFirst).mockResolvedValueOnce({
      id: "rev-1",
      serviceId: "svc-1",
      version: 3,
      status: "ACTIVE",
    } as any);
    vi.mocked(prisma.serviceDraftRevision.update).mockResolvedValueOnce({
      id: "rev-1",
      version: 4,
    } as any);

    const saved = await saveDraftRevision("svc-1", "rev-1", {
      draftData: { name: "Autosaved Draft" },
      expectedVersion: 3,
      actorId: "staff-1",
    });

    expect(saved.version).toBe(4);
    expect(prisma.service.update).not.toHaveBeenCalled();

    vi.mocked(prisma.serviceDraftRevision.findFirst).mockResolvedValueOnce({
      id: "rev-1",
      serviceId: "svc-1",
      version: 4,
      status: "ACTIVE",
    } as any);

    await expect(
      saveDraftRevision("svc-1", "rev-1", { draftData: { name: "Stale" }, expectedVersion: 3 })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("validates Draft Revision before publish", () => {
    expect(validateDraftRevisionData({ name: "AB" }).isValid).toBe(false);
    expect(
      validateDraftRevisionData({
        name: "Valid Tour",
        packages: [{ name: "Option 1", sellingPrice: 1500 }],
      }).isValid
    ).toBe(true);
  });

  it("archives and restores Service via archivedAt without altering existing status", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce({ id: "svc-1", status: "DRAFT" } as any);
    vi.mocked(prisma.service.update).mockResolvedValueOnce({ id: "svc-1", status: "DRAFT", archivedAt: new Date() } as any);

    const archived = await archiveService("svc-1", "admin-1");
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.status).toBe("DRAFT");

    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce({ id: "svc-1", status: "DRAFT", archivedAt: new Date() } as any);
    vi.mocked(prisma.service.update).mockResolvedValueOnce({ id: "svc-1", status: "DRAFT", archivedAt: null } as any);

    const restored = await restoreService("svc-1", "admin-1");
    expect(restored.archivedAt).toBeNull();
    expect(restored.status).toBe("DRAFT");
  });

  it("assigns global Pickup Zones with nullable overrides", async () => {
    vi.mocked(prisma.service.findUnique).mockResolvedValueOnce({ id: "svc-1" } as any);
    tx.servicePickupZoneAssignment.upsert.mockResolvedValueOnce({
      serviceId: "svc-1",
      pickupZoneId: "zone-global-1",
      surchargeOverride: null,
      morningPickupTimeOverride: "08:15",
    });

    const result = await setServicePickupAssignments("svc-1", [
      { pickupZoneId: "zone-global-1", morningPickupTimeOverride: "08:15", surchargeOverride: null },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].surchargeOverride).toBeNull();
    expect(result[0].morningPickupTimeOverride).toBe("08:15");
  });
});
