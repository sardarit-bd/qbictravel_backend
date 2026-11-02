export const BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "AWAITING_APPROVAL",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
] as const;

export const CONFIRMED_OR_LATER_STATUSES = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const;

export type BookingStatusValue = (typeof BOOKING_STATUSES)[number];

export interface ReportFilters {
  from?: Date;
  to?: Date;
  status?: BookingStatusValue;
  serviceType?: string;
  agentId?: string;
}