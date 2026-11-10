export const COMMISSION_RATE_TYPES = ["PERCENTAGE", "FIXED"] as const;
export const COMMISSION_STATUSES = ["ACTIVE", "CANCELLED"] as const;
export const COMMISSION_POLICY_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export type CommissionRateTypeValue = (typeof COMMISSION_RATE_TYPES)[number];
export type CommissionStatusValue = (typeof COMMISSION_STATUSES)[number];
export type CommissionPolicyStatusValue = (typeof COMMISSION_POLICY_STATUSES)[number];

export interface CreateCommissionPolicyInput {
  name: string;
  description?: string;
  rateType: CommissionRateTypeValue;
  rateValue: number;
  status?: CommissionPolicyStatusValue;
  isActive?: boolean;
}

export interface UpdateCommissionPolicyInput {
  name?: string;
  description?: string;
  rateType?: CommissionRateTypeValue;
  rateValue?: number;
  status?: CommissionPolicyStatusValue;
  isActive?: boolean;
}

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

export interface CommissionPolicyFilters {
  status?: CommissionPolicyStatusValue;
}
