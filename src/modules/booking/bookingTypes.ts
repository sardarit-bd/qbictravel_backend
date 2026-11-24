// REMOVE: import { Prisma } from "@prisma/client";

export interface CreateBookingInput {
  customerId: string;
  agentId?: string | null;
  serviceId: string;
  availabilityId?: string | null;
  packageId?: string | null;
  timeSlotId?: string | null;
  pickupZoneId?: string | null;
  departureTime?: string | null;
  pickupLocation?: string | null;
  isPrivateTransfer?: boolean;
  proposedPrice?: number | string;
  travelDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  notes?: string;
}

export interface CreateStaffBookingInput {
  customerId?: string;
  customer?: {
    name: string;
    email: string;
    phone?: string | null;
  };
  serviceId: string;
  availabilityId?: string | null;
  packageId?: string | null;
  timeSlotId?: string | null;
  pickupZoneId?: string | null;
  departureTime?: string | null;
  pickupLocation?: string | null;
  isPrivateTransfer?: boolean;
  travelDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  notes?: string;
  discount?: {
    discountType: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue: number;
    reason: string;
  };
}

export interface CreateGuestBookingInput {
  customer: {
    name: string;
    email: string;
    phone?: string | null;
  };
  serviceId: string;
  availabilityId?: string | null;
  packageId?: string | null;
  timeSlotId?: string | null;
  pickupZoneId?: string | null;
  departureTime?: string | null;
  pickupLocation?: string | null;
  isPrivateTransfer?: boolean;
  travelDate?: string;
  adults?: number;
  children?: number;
  infants?: number;
  notes?: string;
  referralCode?: string;
}

export interface GuestBookingResult {
  booking: BookingResponse;
  guestSnapshot: {
    guestName: string;
    guestEmail: string;
    guestPhone: string | null;
  };
  accessToken: string;
  guestAccessUrl?: string;
  paymentLink: {
    token: string;
    paymentUrl: string;
  };
}

export interface UpdateBookingPriceInput {
  proposedPrice: number | string;
}

export interface ReviewBookingPriceInput {
  status: "APPROVED" | "REJECTED";
  approvedPrice?: number | string;
  notes?: string;
}

export interface ReviewPendingBookingInput {
  action: "CONFIRM" | "REJECT";
  notes?: string;
  approvedDiscountValue?: number;
  rejectionReason?: string;
}

export interface ListPendingReservationsQuery {
  page?: number;
  limit?: number;
  search?: string;
  paymentStatus?: "UNPAID" | "PARTIALLY_PAID" | "PAID";
}

export type BookingSourceValue = "AGENT" | "ADMIN" | "CUSTOMER" | "DIRECT";

export interface BookingResponse {
  id: string;
  customerId: string;
  agentId: string | null;
  createdById?: string | null;
  source?: BookingSourceValue;
  serviceId: string;
  availabilityId: string | null;
  packageId?: string | null;
  timeSlotId?: string | null;
  pickupZoneId?: string | null;
  departureTime?: string | null;
  pickupLocation?: string | null;
  packagePriceSnapshot?: number | null;
  netPriceSnapshot?: number | null;
  pickupSurcharge?: number;
  taxAmount?: number;
  currency: string;
  basePrice: number; 
  proposedPrice: number | null;
  finalPrice: number; 
  status: "PENDING" | "AWAITING_APPROVAL" | "CONFIRMED" | "CANCELLED";
  requiresApproval: boolean;
  createdAt: Date;
  updatedAt: Date;
  priceApproval: {
    id: string;
    requestedPrice: number; 
    approvedPrice: number | null; 
    status: "PENDING" | "APPROVED" | "REJECTED";
    adminId: string | null;
    reviewedAt: Date | null;
    notes: string | null;
  } | null;
}