import AppError from "../../shared/utils/AppError.js";
import { prisma } from "../../lib/prisma.js";
import * as bookingRepository from "./bookingRepository.js";
import * as pricingService from "../pricing/pricingService.js";
import type {
  CreateBookingInput,
  UpdateBookingPriceInput,
  ReviewBookingPriceInput,
  BookingResponse,
} from "./bookingTypes.js";

const mapBookingToResponse = (booking: any): BookingResponse => {
  if (!booking) return booking;
  return {
    ...booking,
    basePrice: Number(booking.basePrice),
    proposedPrice:
      booking.proposedPrice != null ? Number(booking.proposedPrice) : null,
    finalPrice: Number(booking.finalPrice),
    priceApproval: booking.priceApproval
      ? {
          ...booking.priceApproval,
          requestedPrice: Number(booking.priceApproval.requestedPrice),
          approvedPrice:
            booking.priceApproval.approvedPrice != null
              ? Number(booking.priceApproval.approvedPrice)
              : null,
        }
      : null,
  };
};

export const createBooking = async (
  input: CreateBookingInput,
  isAgent: boolean,
  actorId: string,
): Promise<BookingResponse> => {
  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { pricing: true },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  const now = new Date();
  const activePricing = service.pricing.find(
    (p) =>
      (!p.validFrom || p.validFrom <= now) && (!p.validTo || p.validTo >= now),
  );

  if (!activePricing) {
    throw new AppError("Service has no active pricing", 400);
  }

  const basePrice = Number(activePricing.basePrice);
  let finalPrice = basePrice;
  let proposedPrice = input.proposedPrice
    ? Number(input.proposedPrice)
    : undefined;
  let requiresApproval = false;
  let status: string = "PENDING";

  if (isAgent) {
    if (proposedPrice === undefined) {
      throw new AppError("Agent must provide a proposed price", 400);
    }
    if (input.agentId && input.agentId !== actorId) {
      throw new AppError("Unauthorized to create booking for this agent", 403);
    }

    const limits = await pricingService.getAgentPricingLimit(
      actorId,
      input.serviceId,
    );
    const minAllowedPrice =
      basePrice * (1 - limits.maxDiscountPercentage / 100);

    if (proposedPrice < minAllowedPrice) {
      requiresApproval = true;
      status = "AWAITING_APPROVAL";
      finalPrice = proposedPrice;
    } else {
      finalPrice = proposedPrice;
      status = "CONFIRMED";
    }
  } else {
    if (proposedPrice !== undefined) {
      throw new AppError("Customers cannot negotiate price", 403);
    }
  }

  const booking = await bookingRepository.createBooking({
    ...input,
    agentId: isAgent ? actorId : input.agentId,
    basePrice,
    proposedPrice,
    finalPrice,
    status,
    requiresApproval,
  });

  if (requiresApproval && proposedPrice !== undefined) {
    await bookingRepository.createPriceApproval(booking.id, proposedPrice);
    const updated = await bookingRepository.findBookingById(booking.id);
    return mapBookingToResponse(updated);
  }

  return mapBookingToResponse(booking);
};

export const updateAgentBookingPrice = async (
  bookingId: string,
  input: UpdateBookingPriceInput,
  actorId: string,
): Promise<BookingResponse> => {
  const booking = await bookingRepository.findBookingById(bookingId);

  if (!booking) throw new AppError("Booking not found", 404);
  if (booking.agentId !== actorId)
    throw new AppError("Unauthorized to modify this booking", 403);
  if (booking.status === "CONFIRMED" || booking.status === "CANCELLED") {
    throw new AppError(
      "Cannot modify price of a confirmed or cancelled booking",
      400,
    );
  }

  const proposedPrice = Number(input.proposedPrice);
  const limits = await pricingService.getAgentPricingLimit(
    actorId,
    booking.serviceId,
  );
  const minAllowedPrice =
    Number(booking.basePrice) * (1 - limits.maxDiscountPercentage / 100);

  let requiresApproval = false;
  let status: string = booking.status;

  if (proposedPrice < minAllowedPrice) {
    requiresApproval = true;
    status = "AWAITING_APPROVAL";
  } else {
    requiresApproval = false;
    status = "CONFIRMED";
  }

  return prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        proposedPrice: proposedPrice,
        finalPrice: proposedPrice,
        requiresApproval,
        status: status as any,
      },
    });

    if (requiresApproval) {
      if (booking.priceApproval) {
        await tx.priceApproval.update({
          where: { bookingId },
          data: {
            requestedPrice: proposedPrice,
            status: "PENDING",
            approvedPrice: null,
            reviewedAt: null,
          },
        });
      } else {
        await tx.priceApproval.create({
          data: { bookingId, requestedPrice: proposedPrice, status: "PENDING" },
        });
      }
    } else if (
      booking.priceApproval &&
      booking.priceApproval.status === "PENDING"
    ) {
      await tx.priceApproval.update({
        where: { bookingId },
        data: {
          status: "APPROVED",
          approvedPrice: proposedPrice,
          adminId: actorId,
          reviewedAt: new Date(),
        },
      });
    }

    const updated = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { priceApproval: true },
    });
    return mapBookingToResponse(updated);
  });
};

export const reviewBookingPrice = async (
  bookingId: string,
  input: ReviewBookingPriceInput,
  adminId: string,
): Promise<BookingResponse> => {
  const booking = await bookingRepository.findBookingById(bookingId);

  if (!booking) throw new AppError("Booking not found", 404);
  if (!booking.requiresApproval || booking.status !== "AWAITING_APPROVAL") {
    throw new AppError("This booking does not require price approval", 400);
  }

  if (input.status === "APPROVED") {
    if (!input.approvedPrice)
      throw new AppError("Approved price is required for approval", 400);
    const updated = await bookingRepository.updateBookingPriceApproval(
      bookingId,
      {
        approvedPrice: Number(input.approvedPrice),
        adminId,
        notes: input.notes,
      },
    );
    return mapBookingToResponse(updated);
  }

  const rejected = await bookingRepository.rejectPriceApproval(
    bookingId,
    adminId,
    input.notes,
  );
  return mapBookingToResponse(rejected);
};
