import { describe, it, expect, vi, beforeEach } from "vitest";
import * as pricingService from "../../pricingService.js";
import * as pricingRepository from "../../pricingRepository.js";
import AppError from "../../../../shared/utils/AppError.js";

vi.mock("../../pricingRepository.js");

describe("Pricing Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPricingRule", () => {
    it("should create a pricing rule successfully", async () => {
      const input = { name: "10% Limit", type: "AGENT_DISCOUNT_LIMIT" as const, value: 10 };
      const mockRule = { id: "1", ...input, isActive: true };
      vi.mocked(pricingRepository.createPricingRule).mockResolvedValue(mockRule as any);

      const result = await pricingService.createPricingRule(input);
      expect(result).toEqual(mockRule);
      expect(pricingRepository.createPricingRule).toHaveBeenCalledWith(input);
    });
  });

  describe("getPricingRule", () => {
    it("should return a rule if it exists", async () => {
      const mockRule = { id: "1", name: "Test" };
      vi.mocked(pricingRepository.findPricingRuleById).mockResolvedValue(mockRule as any);

      const result = await pricingService.getPricingRule("1");
      expect(result).toEqual(mockRule);
    });

    it("should throw 404 if rule does not exist", async () => {
      vi.mocked(pricingRepository.findPricingRuleById).mockResolvedValue(null);

      await expect(pricingService.getPricingRule("999")).rejects.toThrow(
        new AppError("Pricing rule not found", 404)
      );
    });
  });

  describe("getAgentPricingLimit", () => {
    it("should map repository 'ruleId' to service 'applicableRuleId'", async () => {
      // Mock the repository returning 'ruleId'
      const mockRepoResult = { maxDiscountPercentage: 15, ruleId: "rule-1" };
      vi.mocked(pricingRepository.getAgentPricingLimit).mockResolvedValue(mockRepoResult as any);

      const result = await pricingService.getAgentPricingLimit("agent-1", "service-1");
      
      // Assert the service correctly maps it to 'applicableRuleId'
      expect(result).toEqual({ maxDiscountPercentage: 15, applicableRuleId: "rule-1" });
    });
  });
});