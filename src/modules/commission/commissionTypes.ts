export const COMMISSION_RATE_TYPES = ["PERCENTAGE", "FIXED"] as const;
export const COMMISSION_STATUSES = ["ACTIVE", "CANCELLED"] as const;

export type CommissionRateTypeValue = (typeof COMMISSION_RATE_TYPES)[number];
export type CommissionStatusValue = (typeof COMMISSION_STATUSES)[number];

export interface ConfigureCommissionRuleInput {
  rateType: CommissionRateTypeValue;
  rateValue: number;
}

export interface AdjustCommissionInput {
  amount: number;
  reason: string;
}

export interface CommissionFilters {
  agentId?: string;
  bookingId?: string;
  status?: CommissionStatusValue;
}