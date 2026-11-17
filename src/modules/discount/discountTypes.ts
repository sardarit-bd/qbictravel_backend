import type { DiscountType, DiscountApprovalStatus } from "../../../generated/prisma/client.js";

export interface CreateStaffDiscountRequestInput {
  discountType: DiscountType;
  discountValue: number;
  reason: string;
}

export interface ReviewStaffDiscountRequestInput {
  decision: "APPROVE" | "REJECT";
  approvedDiscountValue?: number;
  adminNotes?: string;
  rejectionReason?: string;
}

export interface ListStaffDiscountRequestsQuery {
  page?: number;
  limit?: number;
  status?: DiscountApprovalStatus;
  bookingId?: string;
  requestedById?: string;
  reviewedById?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface StaffDiscountRequestResponse {
  id: string;
  bookingId: string;
  discountType: DiscountType;
  discountValue: number;
  originalPrice: number;
  discountAmount: number;
  proposedFinalPrice: number;
  approvedDiscountAmount: number | null;
  approvedFinalPrice: number | null;
  status: DiscountApprovalStatus;
  reason: string;
  rejectionReason: string | null;
  adminNotes: string | null;
  requestedById: string;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  booking?: {
    id: string;
    currency: string;
    status: string;
    paymentStatus: string;
    customer?: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
    };
    service?: {
      id: string;
      name: string;
      type: string;
    };
  };
  requestedBy?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  reviewedBy?: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
}

export interface StaffDiscountSummaryResponse {
  totalRequests: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  totalApprovedDiscountAmount: number;
  staffStats: Array<{
    staffId: string;
    staffName: string;
    staffEmail: string;
    totalRequests: number;
    pendingRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    totalApprovedDiscountAmount: number;
  }>;
}
