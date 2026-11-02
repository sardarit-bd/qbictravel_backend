import { describe, it, expect } from "vitest";
import { calculateCommissionAmount } from "../../commissionCalculator.js";

describe("calculateCommissionAmount", () => {
  it("calculates a percentage of the base amount", () => {
    expect(calculateCommissionAmount("PERCENTAGE", 10, 450)).toBe(45);
  });

  it("rounds to the nearest cent", () => {
    expect(calculateCommissionAmount("PERCENTAGE", 12.5, 99.99)).toBe(12.5);
  });

  it("uses a fixed amount", () => {
    expect(calculateCommissionAmount("FIXED", 50, 450)).toBe(50);
  });

  it("never exceeds the base amount", () => {
    expect(calculateCommissionAmount("FIXED", 600, 450)).toBe(450);
    expect(calculateCommissionAmount("PERCENTAGE", 100, 450)).toBe(450);
  });

  it("returns 0 for a zero base amount", () => {
    expect(calculateCommissionAmount("PERCENTAGE", 10, 0)).toBe(0);
  });
});