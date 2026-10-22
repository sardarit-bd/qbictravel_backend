export const FULFILLMENT_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED"] as const;

export type FulfillmentStatusValue = (typeof FULFILLMENT_STATUSES)[number];
export type OperationalBookingStatus = "CONFIRMED" | "IN_PROGRESS" | "COMPLETED";
export type OperationalActorRole = "staff" | "admin";

export interface UpdateOperationalStatusInput {
  fulfillmentStatus: FulfillmentStatusValue;
  notes?: string;
}

export interface AssignBookingInput {
  staffId: string | null;
  notes?: string;
}

export interface OperationalFilters {
  assignedStaffId?: string;
  fulfillmentStatus?: FulfillmentStatusValue;
}