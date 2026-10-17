import { prisma } from "../../lib/prisma.js";
import type { CreateBookingInput } from "./bookingTypes.js";

export const createBooking = async (input: CreateBookingInput & { 
  basePrice: number; 
  finalPrice: number; 
  status: string; 
  requiresApproval: boolean 
}) => {
  return prisma.booking.create({
    data: {
      customerId: input.customerId,
      agentId: input.agentId || null,
      serviceId: input.serviceId,
      availabilityId: input.availabilityId || null,
      basePrice: input.basePrice, // Pass number directly
      proposedPrice: input.proposedPrice !== undefined ? Number(input.proposedPrice) : null,
      finalPrice: input.finalPrice,
      status: input.status as any,
      requiresApproval: input.requiresApproval,
    },
    include: {
      priceApproval: true,
    },
  });
};

export const findBookingById = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      priceApproval: true,
    },
  });
};

export const updateBookingPriceApproval = async (bookingId: string, input: { approvedPrice: number; adminId: string; notes?: string }) => {
  return prisma.$transaction(async (tx) => {
    await tx.priceApproval.update({
      where: { bookingId },
      data: {
        approvedPrice: input.approvedPrice, // Pass number directly
        status: "APPROVED",
        adminId: input.adminId,
        reviewedAt: new Date(),
        notes: input.notes || null,
      },
    });

    return tx.booking.update({
      where: { id: bookingId },
      data: {
        finalPrice: input.approvedPrice,
        status: "CONFIRMED",
        requiresApproval: false,
      },
      include: {
        priceApproval: true,
      },
    });
  });
};

export const rejectPriceApproval = async (bookingId: string, adminId: string, notes?: string) => {
  return prisma.$transaction(async (tx) => {
    await tx.priceApproval.update({
      where: { bookingId },
      data: {
        status: "REJECTED",
        adminId,
        reviewedAt: new Date(),
        notes: notes || null,
      },
    });

    return tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
        requiresApproval: false,
      },
      include: {
        priceApproval: true,
      },
    });
  });
};

export const createPriceApproval = async (bookingId: string, requestedPrice: number) => {
  return prisma.priceApproval.create({
    data: {
      bookingId,
      requestedPrice: requestedPrice, // Pass number directly
      status: "PENDING",
    },
  });
};