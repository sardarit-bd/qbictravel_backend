export type DashboardEventType =
  | "booking.created"
  | "booking.updated"
  | "booking.status_changed"
  | "booking.approved"
  | "booking.rejected"
  | "payment.verified"
  | "payment.refunded"
  | "booking.staff_assigned"
  | "booking.completed"
  | "booking.cancelled";

export interface DashboardEventMetadata {
  customerId?: string | null;
  agentId?: string | null;
  assignedStaffId?: string | null;
  createdById?: string | null;
  affiliateId?: string | null;
  serviceId?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  currency?: string | null;
  amount?: number | null;
  requiresApproval?: boolean | null;
  [key: string]: unknown;
}

export interface DashboardEventPayload {
  id: string; // Unique event ID for Last-Event-ID tracking and deduplication
  type: DashboardEventType;
  entityId: string; // e.g. bookingId or paymentId
  timestamp: string; // ISO 8601 string
  metadata: DashboardEventMetadata;
}

export interface AuthenticatedSSEUser {
  id: string;
  role: "admin" | "staff" | "agent" | "customer" | "affiliate" | string;
  tokenVersion?: number;
}
