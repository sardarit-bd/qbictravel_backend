import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import * as discountRepository from "./discountRepository.js";
import type {
  CreateStaffDiscountRequestInput,
  ReviewStaffDiscountRequestInput,
  ListStaffDiscountRequestsQuery,
  StaffDiscountRequestResponse,
  StaffDiscountSummaryResponse,
} from "./discountTypes.js";

const ELIGIBLE_DISCOUNT_BOOKING_STATUSES = ["PENDING", "CONFIRMED"];

/**
 * Maps a Prisma StaffDiscountRequest record to a clean, JSON-serializable API response.
 */
export const mapDiscountRequestToResponse = (
  record: any
): StaffDiscountRequestResponse => ({
  id: record.id,
  bookingId: record.bookingId,
  discountType: record.discountType,
  discountValue: Number(record.discountValue),
  originalPrice: Number(record.originalPrice),
  discountAmount: Number(record.discountAmount),
  proposedFinalPrice: Number(record.proposedFinalPrice),
  approvedDiscountAmount:
    record.approvedDiscountAmount !== null
      ? Number(record.approvedDiscountAmount)
      : null,
  approvedFinalPrice:
    record.approvedFinalPrice !== null
      ? Number(record.approvedFinalPrice)
      : null,
  status: record.status,
  reason: record.reason,
  rejectionReason: record.rejectionReason,
  adminNotes: record.adminNotes,
  requestedById: record.requestedById,
  reviewedById: record.reviewedById,
  reviewedAt: record.reviewedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  booking: record.booking
    ? {
        id: record.booking.id,
        currency: record.booking.currency,
        status: record.booking.status,
        paymentStatus: record.booking.paymentStatus,
        customer: record.booking.customer,
        service: record.booking.service,
      }
    : undefined,
  requestedBy: record.requestedBy,
  reviewedBy: record.reviewedBy,
});

/**
 * Creates a staff discount request for a booking inside a transaction.
 */
export const createStaffDiscountRequest = async (
  bookingId: string,
  input: CreateStaffDiscountRequestInput,
  staffUser: { id: string; role: string }
): Promise<StaffDiscountRequestResponse> => {
  return prisma.$transaction(async (tx) => {
    // 1. Fetch booking
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        requiresApproval: true,
        currency: true,
        basePrice: true,
        finalPrice: true,
        createdById: true,
        assignedStaffId: true,
        agentId: true,
      },
    });

    if (!booking) {
      throw new AppError("Booking not found", 404);
    }

    // 2. Staff authorization check
    // Staff must be creator, assigned staff, or admin
    const isCreator = booking.createdById === staffUser.id;
    const isAssigned = booking.assignedStaffId === staffUser.id;
    const isAdmin = staffUser.role === "admin";

    if (!isCreator && !isAssigned && !isAdmin) {
      throw new AppError(
        "You are not authorized to request a discount for this booking",
        403
      );
    }

    // 3. Booking state eligibility
    if (!ELIGIBLE_DISCOUNT_BOOKING_STATUSES.includes(booking.status)) {
      throw new AppError(
        `Cannot request discount for booking in ${booking.status} status`,
        400
      );
    }

    if (booking.paymentStatus === "PAID") {
      throw new AppError(
        "Cannot request discount for a booking that has already been paid",
        400
      );
    }

    // 4. Duplicate pending check
    const existingPending = await tx.staffDiscountRequest.findFirst({
      where: {
        bookingId,
        status: "PENDING",
      },
    });

    if (existingPending) {
      throw new AppError(
        "A pending discount request already exists for this booking",
        409
      );
    }

    // 5. Server-side discount calculation based on authoritative basePrice
    const originalPrice = Number(booking.basePrice);
    if (!originalPrice || originalPrice <= 0) {
      throw new AppError("Booking has invalid base price", 400);
    }

    let discountAmount = 0;
    if (input.discountType === "PERCENTAGE") {
      if (input.discountValue <= 0 || input.discountValue > 100) {
        throw new AppError("Percentage discount must be between 1 and 100", 400);
      }
      discountAmount = Math.round(originalPrice * (input.discountValue / 100) * 100) / 100;
    } else if (input.discountType === "FIXED_AMOUNT") {
      if (input.discountValue <= 0) {
        throw new AppError("Fixed discount must be greater than zero", 400);
      }
      if (input.discountValue >= originalPrice) {
        throw new AppError(
          `Fixed discount (${input.discountValue}) must be strictly less than original price (${originalPrice})`,
          400
        );
      }
      discountAmount = Math.round(input.discountValue * 100) / 100;
    } else {
      throw new AppError("Invalid discount type", 400);
    }

    const proposedFinalPrice = Math.round((originalPrice - discountAmount) * 100) / 100;
    if (proposedFinalPrice <= 0) {
      throw new AppError("Proposed final price must be greater than zero", 400);
    }

    // 6. Create StaffDiscountRequest record
    const createdRequest = await tx.staffDiscountRequest.create({
      data: {
        bookingId,
        discountType: input.discountType,
        discountValue: input.discountValue,
        originalPrice,
        discountAmount,
        proposedFinalPrice,
        status: "PENDING",
        reason: input.reason.trim(),
        requestedById: staffUser.id,
      },
      include: discountRepository.staffDiscountRequestInclude,
    });

    // 7. Update booking flags: mark requiresApproval = true, keep finalPrice = standard price
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        requiresApproval: true,
        proposedPrice: proposedFinalPrice,
      },
    });

    // 8. Revoke any currently active payment links to prevent checkout at outdated price
    await tx.paymentLink.updateMany({
      where: {
        bookingId,
        status: "ACTIVE",
      },
      data: {
        status: "EXPIRED",
      },
    });

    // 9. Append DISCOUNT_REQUESTED audit event with complete typed snapshot
    await tx.staffDiscountAuditEvent.create({
      data: {
        discountRequestId: createdRequest.id,
        bookingId,
        actorId: staffUser.id,
        actorRole: staffUser.role,
        action: "DISCOUNT_REQUESTED",
        previousStatus: null,
        newStatus: "PENDING",
        originalPrice,
        discountType: input.discountType,
        discountValue: input.discountValue,
        requestedDiscountAmount: discountAmount,
        proposedFinalPrice,
        approvedDiscountAmount: null,
        finalPrice: originalPrice,
        reason: input.reason.trim(),
        metadata: {
          currency: booking.currency,
        },
      },
    });

    return mapDiscountRequestToResponse(createdRequest);
  });
};

/**
 * Reviews (approves, partially approves, or rejects) a discount request.
 */
export const reviewStaffDiscountRequest = async (
  requestId: string,
  input: ReviewStaffDiscountRequestInput,
  adminUser: { id: string; role: string }
): Promise<StaffDiscountRequestResponse> => {
  if (adminUser.role !== "admin") {
    throw new AppError("Only administrators can review discount requests", 403);
  }

  return prisma.$transaction(async (tx) => {
    // 1. Fetch request with booking
    const request = await tx.staffDiscountRequest.findUnique({
      where: { id: requestId },
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            basePrice: true,
            finalPrice: true,
            currency: true,
          },
        },
      },
    });

    if (!request) {
      throw new AppError("Discount request not found", 404);
    }

    if (request.status !== "PENDING") {
      throw new AppError(
        `Discount request has already been ${request.status.toLowerCase()}`,
        400
      );
    }

    // Self-approval prevention
    if (request.requestedById === adminUser.id) {
      throw new AppError(
        "Staff cannot approve or reject their own discount request",
        403
      );
    }

    const booking = request.booking;
    if (booking.paymentStatus === "PAID") {
      throw new AppError("Cannot review discount for an already paid booking", 400);
    }

    const originalPrice = Number(request.originalPrice);

    if (input.decision === "APPROVE") {
      let approvedDiscountAmount = Number(request.discountAmount);
      let approvedFinalPrice = Number(request.proposedFinalPrice);

      // Handle partial approval if approvedDiscountValue is specified
      if (input.approvedDiscountValue !== undefined) {
        const customVal = Number(input.approvedDiscountValue);
        if (customVal <= 0) {
          throw new AppError("Approved discount value must be greater than zero", 400);
        }

        if (request.discountType === "PERCENTAGE") {
          const requestedPct = Number(request.discountValue);
          if (customVal > requestedPct) {
            throw new AppError(
              `Approved percentage (${customVal}%) cannot exceed requested percentage (${requestedPct}%)`,
              400
            );
          }
          approvedDiscountAmount =
            Math.round(originalPrice * (customVal / 100) * 100) / 100;
        } else if (request.discountType === "FIXED_AMOUNT") {
          const requestedAmt = Number(request.discountValue);
          if (customVal > requestedAmt) {
            throw new AppError(
              `Approved fixed discount (${customVal}) cannot exceed requested discount (${requestedAmt})`,
              400
            );
          }
          approvedDiscountAmount = Math.round(customVal * 100) / 100;
        }

        approvedFinalPrice = Math.round((originalPrice - approvedDiscountAmount) * 100) / 100;
      }

      if (approvedFinalPrice <= 0) {
        throw new AppError("Approved final price must be greater than zero", 400);
      }

      // Optimistic concurrency update for request
      const updatedRequest = await tx.staffDiscountRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          approvedDiscountAmount,
          approvedFinalPrice,
          adminNotes: input.adminNotes?.trim() || null,
          reviewedById: adminUser.id,
          reviewedAt: new Date(),
        },
        include: discountRepository.staffDiscountRequestInclude,
      });

      // Update Booking authoritative finalPrice
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          finalPrice: approvedFinalPrice,
          requiresApproval: false,
        },
      });

      // Revoke any active payment links
      await tx.paymentLink.updateMany({
        where: {
          bookingId: booking.id,
          status: "ACTIVE",
        },
        data: {
          status: "EXPIRED",
        },
      });

      // Append DISCOUNT_APPROVED audit event
      await tx.staffDiscountAuditEvent.create({
        data: {
          discountRequestId: requestId,
          bookingId: booking.id,
          actorId: adminUser.id,
          actorRole: adminUser.role,
          action: "DISCOUNT_APPROVED",
          previousStatus: "PENDING",
          newStatus: "APPROVED",
          originalPrice,
          discountType: request.discountType,
          discountValue: Number(request.discountValue),
          requestedDiscountAmount: Number(request.discountAmount),
          proposedFinalPrice: Number(request.proposedFinalPrice),
          approvedDiscountAmount,
          finalPrice: approvedFinalPrice,
          reason: request.reason,
          adminNotes: input.adminNotes?.trim() || null,
          metadata: {
            currency: booking.currency,
          },
        },
      });

      return mapDiscountRequestToResponse(updatedRequest);
    } else if (input.decision === "REJECT") {
      if (!input.rejectionReason || !input.rejectionReason.trim()) {
        throw new AppError("A rejection reason is required when rejecting a discount request", 400);
      }

      const updatedRequest = await tx.staffDiscountRequest.update({
        where: { id: requestId },
        data: {
          status: "REJECTED",
          rejectionReason: input.rejectionReason.trim(),
          adminNotes: input.adminNotes?.trim() || null,
          reviewedById: adminUser.id,
          reviewedAt: new Date(),
        },
        include: discountRepository.staffDiscountRequestInclude,
      });

      // Booking keeps original standard finalPrice = basePrice, clear requiresApproval
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          requiresApproval: false,
        },
      });

      // Append DISCOUNT_REJECTED audit event
      await tx.staffDiscountAuditEvent.create({
        data: {
          discountRequestId: requestId,
          bookingId: booking.id,
          actorId: adminUser.id,
          actorRole: adminUser.role,
          action: "DISCOUNT_REJECTED",
          previousStatus: "PENDING",
          newStatus: "REJECTED",
          originalPrice,
          discountType: request.discountType,
          discountValue: Number(request.discountValue),
          requestedDiscountAmount: Number(request.discountAmount),
          proposedFinalPrice: Number(request.proposedFinalPrice),
          approvedDiscountAmount: null,
          finalPrice: Number(booking.basePrice),
          reason: request.reason,
          rejectionReason: input.rejectionReason.trim(),
          adminNotes: input.adminNotes?.trim() || null,
          metadata: {
            currency: booking.currency,
          },
        },
      });

      return mapDiscountRequestToResponse(updatedRequest);
    } else {
      throw new AppError("Invalid review decision", 400);
    }
  });
};

/**
 * Lists discount requests with filtering and pagination.
 */
export const listStaffDiscountRequests = async (
  query: ListStaffDiscountRequestsQuery
) => {
  const result = await discountRepository.listDiscountRequests(query);
  return {
    items: result.items.map(mapDiscountRequestToResponse),
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  };
};

/**
 * Returns overall and staff-wise discount performance summaries.
 */
export const getStaffDiscountSummary = async (): Promise<StaffDiscountSummaryResponse> => {
  return discountRepository.getDiscountSummary();
};
