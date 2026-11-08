export const PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "OTHER", "STRIPE"] as const;
export const PAYMENT_RECORD_STATUSES = [
  "INITIATED",
  "SUBMITTED",
  "VERIFIED",
  "REJECTED",
  "PROCESSING",
  "FAILED",
  "CANCELLED",
  "REQUIRES_ACTION",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DISPUTED",
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];
export type PaymentRecordStatusValue = (typeof PAYMENT_RECORD_STATUSES)[number];

export interface CreatePaymentInput {
  method: PaymentMethodValue;
  reference?: string;
  receiptNote?: string;
}

export interface VerifyPaymentInput {
  decision: "VERIFIED" | "REJECTED";
  notes?: string;
}

export interface RecordPaymentInput {
  reference?: string;
  receivedAt?: string | Date;
  notes?: string;
}

export interface PaymentFilters {
  customerId?: string;
  agentId?: string;
  bookingId?: string;
  status?: PaymentRecordStatusValue;
  method?: PaymentMethodValue;
}

export interface CreateStripeSessionInput {
  bookingId: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface StripeCheckoutSessionResult {
  sessionId: string;
  sessionUrl: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: PaymentRecordStatusValue;
}

export interface WebhookProcessingResult {
  received: boolean;
  eventId: string;
  type: string;
  status: "PROCESSED" | "IGNORED" | "FAILED";
  bookingId?: string;
  paymentId?: string;
  message?: string;
}

export interface PaymentReconciliationResult {
  paymentId: string;
  bookingId: string;
  previousStatus: PaymentRecordStatusValue;
  newStatus: PaymentRecordStatusValue;
  reconciled: boolean;
  notes?: string;
}
