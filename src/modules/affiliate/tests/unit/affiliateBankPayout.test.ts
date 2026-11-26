import { describe, it, expect, vi, beforeEach } from "vitest";
import { maskAccountNumber, affiliateService } from "../../affiliateService.js";
import AppError from "../../../../shared/utils/AppError.js";

describe("Affiliate Bank Details & Manual Payouts", () => {
  it("maskAccountNumber correctly masks account numbers longer than 4 chars", () => {
    expect(maskAccountNumber("1234567890")).toBe("•••• •••• •••• 7890");
    expect(maskAccountNumber("987654321")).toBe("•••• •••• •••• 4321");
    expect(maskAccountNumber("1234")).toBe("1234");
    expect(maskAccountNumber("")).toBe("");
    expect(maskAccountNumber(null)).toBe("");
  });
});
