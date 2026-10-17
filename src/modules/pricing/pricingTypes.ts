

export interface PricingRule {
  id: string;
  name: string;
  description: string | null;
  type: "AGENT_DISCOUNT_LIMIT";
  value: number;
  agentId: string | null;
  serviceId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePricingRuleInput {
  name: string;
  description?: string;
  type: "AGENT_DISCOUNT_LIMIT";
  value: number | string;
  agentId?: string;
  serviceId?: string;
  isActive?: boolean;
}

export interface UpdatePricingRuleInput {
  name?: string;
  description?: string | null;
  value?: number | string;
  isActive?: boolean;
}

export interface AgentPricingLimit {
  maxDiscountPercentage: number;
  applicableRuleId: string | null;
}