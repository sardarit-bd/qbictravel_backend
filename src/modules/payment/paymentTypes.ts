export const PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "OTHER"] as const;
export const PAYMENT_RECORD_STATUSES = ["INITIATED", "SUBMITTED", "VERIFIED", "REJECTED"] as const;

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