import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as reportRepository from "../../reportRepository.js";
import * as reportService from "../../reportService.js";

vi.mock("../../reportRepository.js");

const repo = vi.mocked(reportRepository);

const expectAppError = async (promise: Promise<unknown>, statusCode: number) => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode });
};

describe("reportService filters", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.listServiceTypes.mockResolvedValue(["TOUR", "HOTEL"]);
    repo.getBookingStatusBreakdown.mockResolvedValue([]);
  });

  it.each([
    ["invalid from", { from: "not-a-date" }],
    ["invalid to", { to: "nope" }],
    ["from after to", { from: "2026-10-20", to: "2026-10-01" }],
    ["invalid status", { status: "MAYBE" }],
    ["invalid agentId", { agentId: "abc" }],
    ["unknown serviceType", { serviceType: "SPACE" }],
  ])("returns 400 for %s", async (_label, query) => {
    await expectAppError(reportService.getAdminBookingsReport(query), 400);
    expect(repo.getBookingStatusBreakdown).not.toHaveBeenCalled();
  });

  it("treats a date-only to value as the end of that day", async () => {
    await reportService.getAdminBookingsReport({ to: "2026-10-20" });
    expect(repo.getBookingStatusBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({ to: new Date("2026-10-20T23:59:59.999Z") }),
    );
  });

  it("accepts a known service type", async () => {
    await reportService.getAdminBookingsReport({ serviceType: "TOUR" });
    expect(repo.getBookingStatusBreakdown).toHaveBeenCalledWith(expect.objectContaining({ serviceType: "TOUR" }));
  });

  it("forces the agent id for agent reports and ignores a query agentId", async () => {
    await reportService.getAgentBookingsReport("agent-1", { agentId: "123e4567-e89b-12d3-a456-426614174099" });
    expect(repo.getBookingStatusBreakdown).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-1" }));
  });
});

describe("reportService reports", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.listServiceTypes.mockResolvedValue(["TOUR"]);
  });

  it("summarises bookings by status", async () => {
    repo.getBookingStatusBreakdown.mockResolvedValue([
      { status: "CONFIRMED", _count: { _all: 2 }, _sum: { finalPrice: "200.00" } },
      { status: "COMPLETED", _count: { _all: 3 }, _sum: { finalPrice: "450.50" } },
    ] as any);

    const result = await reportService.getAdminBookingsReport({});

    expect(result.totalBookings).toBe(5);
    expect(result.byStatus).toEqual([
      { status: "CONFIRMED", count: 2, totalValue: 200 },
      { status: "COMPLETED", count: 3, totalValue: 450.5 },
    ]);
  });

  it("returns revenue, collected and outstanding as separate metrics", async () => {
    repo.getFinancialTotals.mockResolvedValue({
      bookedValue: 1000.005,
      revenue: 600,
      collectedPayments: 700,
      outstandingBalance: 300,
    });

    const result = await reportService.getAdminRevenueReport({});

    expect(result).toMatchObject({ revenue: 600, collectedPayments: 700, outstandingBalance: 300 });
    expect(result).not.toHaveProperty("commissions");
  });

  it("calculates payment reconciliation", async () => {
    repo.getPaymentBreakdown.mockResolvedValue({
      byStatus: [
        { status: "VERIFIED", _count: { _all: 2 }, _sum: { amount: "800.00" } },
        { status: "SUBMITTED", _count: { _all: 1 }, _sum: { amount: "150.00" } },
      ],
      verifiedByMethod: [{ method: "CASH", _count: { _all: 2 }, _sum: { amount: "800.00" } }],
      paidBookingsValue: 850,
    } as any);

    const result = await reportService.getAdminPaymentsReport({});

    expect(result.reconciliation).toEqual({
      paidBookingsValue: 850,
      verifiedPaymentsValue: 800,
      difference: 50,
      pendingVerificationCount: 1,
      pendingVerificationValue: 150,
    });
  });

  it("aggregates services, sorts by revenue and paginates", async () => {
    repo.getServiceBreakdown.mockResolvedValue({
      rows: [
        { serviceId: "s1", status: "COMPLETED", _count: { _all: 1 }, _sum: { finalPrice: "100.00" } },
        { serviceId: "s1", status: "CANCELLED", _count: { _all: 1 }, _sum: { finalPrice: "50.00" } },
        { serviceId: "s2", status: "COMPLETED", _count: { _all: 2 }, _sum: { finalPrice: "500.00" } },
      ],
      services: [
        { id: "s1", name: "City Tour", type: "TOUR" },
        { id: "s2", name: "Beach Hotel", type: "HOTEL" },
      ],
    } as any);

    const result = await reportService.getAdminServicesReport({ limit: "1" });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ serviceId: "s2", revenue: 500, completedBookings: 2, name: "Beach Hotel" });
  });

  it("aggregates agents with their commission totals and skips unassigned bookings", async () => {
    repo.getAgentBreakdown.mockResolvedValue({
      rows: [
        { agentId: "a1", status: "COMPLETED", _count: { _all: 2 }, _sum: { finalPrice: "300.00" } },
        { agentId: "a1", status: "CONFIRMED", _count: { _all: 1 }, _sum: { finalPrice: "100.00" } },
        { agentId: null, status: "COMPLETED", _count: { _all: 9 }, _sum: { finalPrice: "999.00" } },
      ],
      users: [{ id: "a1", name: "Omar" }],
    } as any);
    repo.getCommissionByAgent.mockResolvedValue({
      rows: [{ agentId: "a1", _count: { _all: 2 }, _sum: { amount: "30.00" } }],
      users: [],
    } as any);

    const result = await reportService.getAdminAgentsReport({});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      agentId: "a1",
      name: "Omar",
      totalBookings: 3,
      revenue: 300,
      bookedValue: 400,
      commissionTotal: 30,
    });
  });

  it("summarises commissions and counts only active ones in the total", async () => {
    repo.getCommissionByStatus.mockResolvedValue([
      { status: "ACTIVE", _count: { _all: 3 }, _sum: { amount: "90.00" } },
      { status: "CANCELLED", _count: { _all: 1 }, _sum: { amount: "20.00" } },
    ] as any);
    repo.getCommissionByAgent.mockResolvedValue({
      rows: [{ agentId: "a1", _count: { _all: 3 }, _sum: { amount: "90.00" } }],
      users: [{ id: "a1", name: "Omar" }],
    } as any);

    const result = await reportService.getAdminCommissionsReport({});

    expect(result.count).toBe(4);
    expect(result.totalActiveAmount).toBe(90);
    expect(result.items[0]).toMatchObject({ agentId: "a1", name: "Omar", totalAmount: 90 });
  });

  it("returns an agent commission summary without per-agent items", async () => {
    repo.getCommissionByStatus.mockResolvedValue([
      { status: "ACTIVE", _count: { _all: 1 }, _sum: { amount: "45.00" } },
    ] as any);

    const result = await reportService.getAgentCommissionsReport("agent-1", {});

    expect(repo.getCommissionByStatus).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-1" }));
    expect(result.totalActiveAmount).toBe(45);
    expect(result).not.toHaveProperty("items");
  });

  it("returns 400 for an invalid page on a paginated report", async () => {
    await expectAppError(reportService.getAdminServicesReport({ page: "0" }), 400);
  });
});