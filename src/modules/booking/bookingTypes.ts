// REMOVE: import { Prisma } from "@prisma/client";

export interface CreateBookingInput {
  customerId: string;
  agentId?: string;
  serviceId: string;
  availabilityId?: string;
  proposedPrice?: number | string;
}

export interface UpdateBookingPriceInput {
  proposedPrice: number | string;
}

export interface ReviewBookingPriceInput {
  status: "APPROVED" | "REJECTED";
  approvedPrice?: number | string;
  notes?: string;
}

export interface BookingResponse {
  id: string;
  customerId: string;
  agentId: string | null;
  serviceId: string;
  availabilityId: string | null;
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