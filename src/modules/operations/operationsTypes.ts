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
  agentId?: string;
  createdById?: string;
  source?: "AGENT" | "ADMIN" | "CUSTOMER" | "DIRECT";
}

export interface OperationsScheduleItem {
  id: string;
  reference: string;
  bookingRef?: string;
  serviceId: string;
  serviceName: string;
  serviceTitle?: string;
  serviceImage?: string | null;
  serviceType: string;
  travelDate: string;
  departureTime: string | null;
  hasDepartureTime: boolean;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  adults: number;
  children: number;
  infants: number;
  totalPassengers: number;
  totalGuests?: number;
  pickupLocation: string | null;
  specialInstructions: string | null;
  bookingStatus: string;
  paymentStatus: string;
  fulfillmentStatus: FulfillmentStatusValue;
  assignedStaffName: string | null;
  source: string;
}

export interface OperationsScheduleGroup {
  travelDate: string;
  serviceId: string;
  serviceName: string;
  serviceTitle?: string;
  serviceImage?: string | null;
  serviceType: string;
  departureTime: string | null;
  hasDepartureTime: boolean;
  totalBookings: number;
  totalPassengers: number;
  totalAdults: number;
  totalChildren: number;
  totalInfants: number;
  capacity: {
    total: number | null;
    bookedCount: number;
    remaining: number | null;
  } | null;
  pickupSummary: {
    locationsCount: number;
    locations: string[];
  };
  pickupLocations?: string[];
  fulfillmentCounts: {
    notStarted: number;
    inProgress: number;
    fulfilled: number;
  };
  bookings: OperationsScheduleItem[];
}

export interface OperationsScheduleResponse {
  startDate: string;
  endDate: string;
  totalGroups: number;
  totalBookings: number;
  totalPassengers: number;
  groups: OperationsScheduleGroup[];
}
