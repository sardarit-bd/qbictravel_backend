import AppError from "../../shared/utils/AppError.js";
import * as pricingRepository from "./pricingRepository.js";
import type {
  CreatePricingRuleInput,
  UpdatePricingRuleInput,
  AgentPricingLimit,
  ProposeBookingPriceInput,
  ReviewPriceApprovalInput,
} from "./pricingTypes.js";

export const createPricingRule = async (input: CreatePricingRuleInput) => {
  return pricingRepository.createPricingRule(input);
};

export const getPricingRule = async (ruleId: string) => {
  const rule = await pricingRepository.findPricingRuleById(ruleId);
  if (!rule) {
    throw new AppError("Pricing rule not found", 404);
  }
  return rule;
};

export const updatePricingRule = async (ruleId: string, input: UpdatePricingRuleInput) => {
  await getPricingRule(ruleId);
  return pricingRepository.updatePricingRule(ruleId, input);
};

export const listPricingRules = async () => {
  return pricingRepository.listPricingRules();
};

export const getAgentPricingLimit = async (agentId: string, serviceId?: string): Promise<AgentPricingLimit> => {
  const repoResult = await pricingRepository.getAgentPricingLimit(agentId, serviceId);
  return {
    maxDiscountPercentage: repoResult.maxDiscountPercentage,
    applicableRuleId: (repoResult as any).applicableRuleId ?? (repoResult as any).ruleId ?? null,
  };
};

const toCents = (value: unknown): number => Math.round(Number(value) * 100);
const fromCents = (cents: number): number => cents / 100;

const PRICE_EDITABLE_STATUSES: string[] = ["PENDING", "AWAITING_APPROVAL"];

export const proposeBookingPrice = async (
  agentId: string,
  bookingId: string,
  input: ProposeBookingPriceInput,
) => {
  const booking = await pricingRepository.findBookingWithApproval(bookingId);

  if (!booking || booking.agentId !== agentId) {
    throw new AppError("Booking not found", 404);
  }

  if (!PRICE_EDITABLE_STATUSES.includes(booking.status) || booking.paymentStatus !== "UNPAID") {
    throw new AppError("The price of this booking can no longer be changed", 409);
  }

  const baseCents = toCents(booking.basePrice);
  const priceCents = toCents(input.price);

  if (priceCents > baseCents) {
    throw new AppError("Proposed price cannot exceed the booking base price", 400);
  }

  const limit = await getAgentPricingLimit(agentId, booking.serviceId);
  const limitBasisPoints = Math.round(limit.maxDiscountPercentage * 100);
  const minimumAutoApprovedCents = Math.ceil((baseCents * (10000 - limitBasisPoints)) / 10000);
  const requiresApproval = priceCents < minimumAutoApprovedCents;
  const discountPercentage =
    baseCents === 0 ? 0 : Math.round(((baseCents - priceCents) / baseCents) * 10000) / 100;

  const updated = await pricingRepository.applyAgentPriceProposal({
    bookingId,
    agentId,
    price: fromCents(priceCents),
    requiresApproval,
    changes: {
      basePrice: fromCents(baseCents),
      proposedPrice: fromCents(priceCents),
      previousProposedPrice: booking.proposedPrice === null ? null : Number(booking.proposedPrice),
      previousFinalPrice: Number(booking.finalPrice),
      discountPercentage,
      maxDiscountPercentage: limit.maxDiscountPercentage,
      applicableRuleId: limit.applicableRuleId,
      requiresApproval,
      notes: input.notes ?? null,
    },
  });

  if (!updated) {
    throw new AppError("Booking changed while the price was being updated. Please retry.", 409);
  }

  return updated;
};

export const reviewPriceApproval = async (
  adminId: string,
  bookingId: string,
  input: ReviewPriceApprovalInput,
) => {
  const booking = await pricingRepository.findBookingWithApproval(bookingId);

  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  const approval = booking.priceApproval;

  if (!approval || approval.status !== "PENDING" || booking.status !== "AWAITING_APPROVAL") {
    throw new AppError("This booking has no pending price approval", 409);
  }

  const baseCents = toCents(booking.basePrice);
  const requestedCents = toCents(approval.requestedPrice);
  let approvedPrice: number | null = null;

  if (input.decision === "REJECTED") {
    if (input.approvedPrice !== undefined) {
      throw new AppError("An approved price cannot be set when rejecting", 400);
    }
  } else {
    const approvedCents =
      input.approvedPrice === undefined ? requestedCents : toCents(input.approvedPrice);

    if (approvedCents < requestedCents || approvedCents > baseCents) {
      throw new AppError(
        "Approved price must be between the requested price and the booking base price",
        400,
      );
    }

    approvedPrice = fromCents(approvedCents);
  }

  const updated = await pricingRepository.applyPriceApprovalDecision({
    bookingId,
    adminId,
    decision: input.decision,
    approvedPrice,
    notes: input.notes,
    changes: {
      decision: input.decision,
      requestedPrice: fromCents(requestedCents),
      approvedPrice,
      previousFinalPrice: Number(booking.finalPrice),
      newFinalPrice: approvedPrice ?? Number(booking.finalPrice),
      notes: input.notes ?? null,
    },
  });

  if (!updated) {
    throw new AppError("Booking changed while the approval was being reviewed. Please retry.", 409);
  }

  return updated;
};