import { describe, it, expect } from "vitest";
import {
  getCurrencyMultiplier,
  toStripeAmount,
  fromStripeAmount,
} from "../../currencyUtils.js";

describe("currencyUtils", () => {
  it("determines correct multipliers for 2-decimal, zero-decimal, and 3-decimal currencies", () => {
    // 2-decimal
    expect(getCurrencyMultiplier("USD")).toBe(100);
    expect(getCurrencyMultiplier("EUR")).toBe(100);
    expect(getCurrencyMultiplier("THB")).toBe(100);
    expect(getCurrencyMultiplier("SGD")).toBe(100);

    // zero-decimal
    expect(getCurrencyMultiplier("JPY")).toBe(1);
    expect(getCurrencyMultiplier("KRW")).toBe(1);
    expect(getCurrencyMultiplier("VND")).toBe(1);

    // 3-decimal
    expect(getCurrencyMultiplier("BHD")).toBe(1000);
    expect(getCurrencyMultiplier("KWD")).toBe(1000);
    expect(getCurrencyMultiplier("OMR")).toBe(1000);
  });

  it("converts standard nominal amount to Stripe minor units correctly", () => {
    // 2-decimal
    expect(toStripeAmount(2500.5, "THB")).toBe(250050);
    expect(toStripeAmount("100.00", "USD")).toBe(10000);
    expect(toStripeAmount(49.99, "EUR")).toBe(4999);

    // zero-decimal
    expect(toStripeAmount(5000, "JPY")).toBe(5000);
    expect(toStripeAmount("12500", "VND")).toBe(12500);

    // 3-decimal
    expect(toStripeAmount(12.345, "KWD")).toBe(12345);
  });

  it("converts Stripe minor units back to standard nominal amount correctly", () => {
    expect(fromStripeAmount(250050, "THB")).toBe(2500.5);
    expect(fromStripeAmount(10000, "USD")).toBe(100);
    expect(fromStripeAmount(5000, "JPY")).toBe(5000);
    expect(fromStripeAmount(12345, "KWD")).toBe(12.345);
  });

  it("throws for invalid amounts", () => {
    expect(() => toStripeAmount("invalid", "THB")).toThrow("Invalid amount");
    expect(() => toStripeAmount(-10, "THB")).toThrow("Invalid amount");
  });
});
