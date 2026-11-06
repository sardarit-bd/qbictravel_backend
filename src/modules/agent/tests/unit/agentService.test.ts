import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as agentRepository from "../../agentRepository.js";
import * as agentService from "../../agentService.js";

vi.mock("../../agentRepository.js");

const repo = vi.mocked(agentRepository);

describe("agentService unit tests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getAgentOverview", () => {
    it("returns overview metrics from repository", async () => {
      const mockMetrics = {
        totalBookings: 10,
        pendingBookings: 2,
        confirmedBookings: 5,
        completedBookings: 3,
        cancelledBookings: 0,
        totalCommission: 500,
        paidCommission: 300,
        pendingCommission: 200,
        activeCommissionsCount: 8,
      };

      repo.getAgentOverview.mockResolvedValue(mockMetrics);

      const result = await agentService.getAgentOverview("agent-1");
      expect(result).toEqual(mockMetrics);
      expect(repo.getAgentOverview).toHaveBeenCalledWith("agent-1");
    });
  });

  describe("listAgentBookings", () => {
    it("delegates to agentRepository with agentId and params", async () => {
      const mockList = {
        items: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      };

      repo.listAgentBookings.mockResolvedValue(mockList);

      const result = await agentService.listAgentBookings("agent-1", { page: 1, limit: 10 });
      expect(result).toEqual(mockList);
      expect(repo.listAgentBookings).toHaveBeenCalledWith("agent-1", { page: 1, limit: 10 });
    });
  });

  describe("getAgentBooking", () => {
    it("returns booking when found for agent", async () => {
      const mockBooking: any = { id: "bk-1", agentId: "agent-1", status: "CONFIRMED" };
      repo.findAgentBookingById.mockResolvedValue(mockBooking);

      const result = await agentService.getAgentBooking("agent-1", "bk-1");
      expect(result).toEqual(mockBooking);
      expect(repo.findAgentBookingById).toHaveBeenCalledWith("agent-1", "bk-1");
    });

    it("throws 404 when booking not found or belongs to another agent", async () => {
      repo.findAgentBookingById.mockResolvedValue(null);

      await expect(agentService.getAgentBooking("agent-1", "bk-999")).rejects.toThrow(
        AppError
      );
    });
  });

  describe("getAgentProfile", () => {
    it("returns agent profile with agencyName", async () => {
      const mockProfile: any = {
        id: "agent-1",
        name: "Test Agent",
        email: "agent@test.com",
        phone: "+66 81 234 5678",
        role: "agent",
        status: "active",
        agencyName: "Phuket Sun Travel",
        createdAt: new Date(),
      };

      repo.findAgentProfile.mockResolvedValue(mockProfile);

      const result = await agentService.getAgentProfile("agent-1");
      expect(result).toEqual(mockProfile);
    });

    it("throws 404 if agent not found", async () => {
      repo.findAgentProfile.mockResolvedValue(null);

      await expect(agentService.getAgentProfile("agent-unknown")).rejects.toThrow(AppError);
    });
  });

  describe("updateAgentProfile", () => {
    it("updates agencyName successfully", async () => {
      const existing: any = { id: "agent-1", agencyName: "Old Agency" };
      const updated: any = { id: "agent-1", agencyName: "New Agency" };

      repo.findAgentProfile.mockResolvedValue(existing);
      repo.updateAgentProfile.mockResolvedValue(updated);

      const result = await agentService.updateAgentProfile("agent-1", {
        agencyName: "New Agency",
      });

      expect(result).toEqual(updated);
      expect(repo.updateAgentProfile).toHaveBeenCalledWith("agent-1", {
        agencyName: "New Agency",
      });
    });

    it("throws 404 if trying to update non-existent agent", async () => {
      repo.findAgentProfile.mockResolvedValue(null);

      await expect(
        agentService.updateAgentProfile("agent-unknown", { agencyName: "X" })
      ).rejects.toThrow(AppError);
    });
  });
});
