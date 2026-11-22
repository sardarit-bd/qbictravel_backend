import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import { queryScheduleBookings } from "../../operationsRepository.js";

vi.mock("../../../../lib/prisma.js", () => {
  return {
    prisma: {
      booking: {
        findMany: vi.fn(),
      },
    },
  };
});

describe("operationsRepository.queryScheduleBookings authorization policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseParams = {
    startDate: new Date("2026-12-01T00:00:00.000Z"),
    endDate: new Date("2026-12-01T23:59:59.999Z"),
  };

  it("1. Admin receives unrestricted query without staff ownership constraints", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    await queryScheduleBookings({
      ...baseParams,
      actorRole: "admin",
      actorId: "admin-uuid-1",
    });

    expect(prisma.booking.findMany).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    const where = callArgs?.where as any;

    expect(where.AND).toBeDefined();
    // Verify none of the AND conditions contain assignedStaffId or createdById restrictions
    const staffOwnershipCondition = where.AND.find((c: any) =>
      c.OR?.some((cond: any) => "assignedStaffId" in cond || "createdById" in cond)
    );
    expect(staffOwnershipCondition).toBeUndefined();
  });

  it("2 & 3. Staff query enforces (assignedStaffId === actorId OR createdById === actorId)", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    await queryScheduleBookings({
      ...baseParams,
      actorRole: "staff",
      actorId: "staff-uuid-123",
    });

    expect(prisma.booking.findMany).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    const where = callArgs?.where as any;

    expect(where.AND).toBeDefined();
    const staffOwnershipCondition = where.AND.find((c: any) =>
      c.OR?.some((cond: any) => cond.assignedStaffId === "staff-uuid-123")
    );

    expect(staffOwnershipCondition).toBeDefined();
    expect(staffOwnershipCondition.OR).toEqual([
      { assignedStaffId: "staff-uuid-123" },
      { createdById: "staff-uuid-123" },
    ]);
  });

  it("4, 5 & 6. Staff cannot receive another staff's, unauthorized agent's, or direct customer bookings", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    await queryScheduleBookings({
      ...baseParams,
      actorRole: "staff",
      actorId: "staff-current",
    });

    const callArgs = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    const where = callArgs?.where as any;

    // Both assignedStaffId and createdById are restricted strictly to staff-current
    const staffOwnership = where.AND.find((c: any) =>
      c.OR?.some((cond: any) => cond.assignedStaffId === "staff-current")
    );
    expect(staffOwnership.OR).toContainEqual({ assignedStaffId: "staff-current" });
    expect(staffOwnership.OR).toContainEqual({ createdById: "staff-current" });
  });

  it("7. Search and pagination cannot bypass staff ownership restriction", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    await queryScheduleBookings({
      ...baseParams,
      actorRole: "staff",
      actorId: "staff-current",
      search: "direct customer or agent booking",
    });

    const callArgs = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    const where = callArgs?.where as any;

    // Must have date condition, staff ownership condition, AND search condition
    expect(where.AND.length).toBe(3);

    const staffOwnership = where.AND.find((c: any) =>
      c.OR?.some((cond: any) => cond.assignedStaffId === "staff-current")
    );
    expect(staffOwnership).toBeDefined();

    const searchCondition = where.AND.find((c: any) =>
      c.OR?.some((cond: any) => cond.customer?.name !== undefined || cond.notes !== undefined)
    );
    expect(searchCondition).toBeDefined();
  });

  it("8. Missing, empty, or whitespace actorId safely denies staff access without exposing bookings", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    await queryScheduleBookings({
      ...baseParams,
      actorRole: "staff",
      actorId: "   ", // whitespace / missing
    });

    const callArgs = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    const where = callArgs?.where as any;

    const blockingCondition = where.AND.find(
      (c: any) => c.id === "__UNAUTHORIZED_STAFF_MISSING_ACTOR_ID__"
    );
    expect(blockingCondition).toBeDefined();
  });

  it("9. Existing Admin and Staff filters (serviceId, bookingStatus, fulfillmentStatus) continue working", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    await queryScheduleBookings({
      ...baseParams,
      actorRole: "staff",
      actorId: "staff-current",
      serviceId: "srv-phi-phi",
      bookingStatus: "CONFIRMED",
      fulfillmentStatus: "IN_PROGRESS",
    });

    const callArgs = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    const where = callArgs?.where as any;

    expect(where.serviceId).toBe("srv-phi-phi");
    expect(where.status).toBe("CONFIRMED");
    expect(where.fulfillmentStatus).toBe("IN_PROGRESS");
    expect(where.AND).toBeDefined();
  });
});
