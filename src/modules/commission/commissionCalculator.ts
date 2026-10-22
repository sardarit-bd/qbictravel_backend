import type { CommissionRateTypeValue } from "./commissionTypes.js";

const toCents = (value: number): number => Math.round(value * 100);

export const calculateCommissionAmount = (
  rateType: CommissionRateTypeValue,
  rateValue: number,
  baseAmount: number,
): number => {
  const baseCents = toCents(baseAmount);
  const rawCents = rateType === "PERCENTAGE" ? Math.round((baseCents * rateValue) / 100) : toCents(rateValue);
  return Math.min(Math.max(rawCents, 0), baseCents) / 100;
};