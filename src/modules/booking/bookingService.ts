import AppError from "../../shared/utils/AppError.js";
import { prisma } from "../../lib/prisma.js";
import * as bookingRepository from "./bookingRepository.js";
import * as pricingService from "../pricing/pricingService.js";
import * as notificationService from "../notification/notificationService.js";
import { parsePagination } from "../../shared/utils/pagination.js";
import type {
  CreateBookingInput,
  CreateStaffBookingInput,
  UpdateBookingPriceInput,
  ReviewBookingPriceInput,
  ReviewPendingBookingInput,
  ListPendingReservationsQuery,
  BookingResponse,
} from "./bookingTypes.js";
import { resolveOrCreateCustomer } from "../customer/customerHelper.js";

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
  if (isAgent) {
    const customer = await bookingRepository.findActiveCustomer(input.customerId);
    if (!customer) {
      throw new AppError("Customer not found", 404);
    }
  } else {
    if (input.customerId !== actorId) {
      throw new AppError("Customers can only create bookings for themselves", 403);
    }
    if (input.agentId) {
      throw new AppError("Customers cannot assign an agent", 403);
    }
  }

  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { pricing: true },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  const now = new Date();
  const activePricings = service.pricing.filter(
    (p) =>
      (!p.validFrom || p.validFrom <= now) && (!p.validTo || p.validTo >= now),
  );

  if (activePricings.length === 0) {
    throw new AppError("Service has no active pricing", 400);
  }

  if (activePricings.length > 1) {
    throw new AppError(
      "Service has multiple active pricing tiers. Please contact support.",
      409,
    );
  }

  const activePricing = activePricings[0]!;
  const rawBasePrice = Number(activePricing.basePrice);
  const currency = activePricing.currency;

  const hasGuestCounts =
    input.adults !== undefined ||
    input.children !== undefined ||
    input.infants !== undefined;

  let basePrice = rawBasePrice;

  if (hasGuestCounts) {
    const adults = Math.max(1, Number(input.adults ?? 1));
    const children = Math.max(0, Number(input.children ?? 0));
    const infants = Math.max(0, Number(input.infants ?? 0));

    const unitAdultPrice =
      activePricing.discountedPrice != null &&
      Number(activePricing.discountedPrice) > 0
        ? Number(activePricing.discountedPrice)
        : rawBasePrice;

    const metadata = (service as any).metadata as Record<string, any> | null;
    const tiers: Array<{ tierName?: string; price?: number }> = Array.isArray(
      metadata?.pricingTiers,
    )
      ? metadata!.pricingTiers
      : [];

    const childTier = tiers.find((t) =>
      /child/i.test(String(t?.tierName || "")),
    );
    const infantTier = tiers.find((t) =>
      /infant/i.test(String(t?.tierName || "")),
    );

    const unitChildPrice =
      childTier && typeof childTier.price === "number" && childTier.price >= 0
        ? Number(childTier.price)
        : Math.round(unitAdultPrice * 0.7 * 100) / 100;

    const unitInfantPrice =
      infantTier &&
      typeof infantTier.price === "number" &&
      infantTier.price >= 0
        ? Number(infantTier.price)
        : 0;

    basePrice =
      Math.round(
        (adults * unitAdultPrice +
          children * unitChildPrice +
          infants * unitInfantPrice) *
          100,
      ) / 100;
  }

  let finalPrice = basePrice;
  let proposedPrice = input.proposedPrice
    ? Number(input.proposedPrice)
    : undefined;
  let requiresApproval = false;
  let status: string = "PENDING";

  // Resolve or auto-link ServiceAvailability record if travelDate is provided and availabilityId is not
  let resolvedAvailabilityId = input.availabilityId;
  if (!resolvedAvailabilityId && input.travelDate && input.travelDate.trim()) {
    try {
      const travelDateObj = new Date(input.travelDate.trim());
      if (!isNaN(travelDateObj.getTime())) {
        const availabilityRecord = await prisma.serviceAvailability.upsert({
          where: {
            serviceId_date: {
              serviceId: input.serviceId,
              date: travelDateObj,
            },
          },
          update: {
            bookedCount: { increment: 1 },
            lastVerifiedAt: new Date(),
          },
          create: {
            serviceId: input.serviceId,
            date: travelDateObj,
            isAvailable: true,
            bookedCount: 1,
            lastVerifiedAt: new Date(),
          },
        });
        resolvedAvailabilityId = availabilityRecord.id;
      }
    } catch {
      // In case of availability constraint or failure, continue with availabilityId=undefined
    }
  }

  // Build structured notes if travelDate or guest counts are provided
  const noteParts: string[] = [];
  if (input.travelDate && input.travelDate.trim()) {
    noteParts.push(`Travel Date: ${input.travelDate.trim()}`);
  }
  if (hasGuestCounts) {
    const adults = Math.max(1, Number(input.adults ?? 1));
    const children = Math.max(0, Number(input.children ?? 0));
    const infants = Math.max(0, Number(input.infants ?? 0));
    const guestParts = [`${adults} Adult${adults > 1 ? "s" : ""}`];
    if (children > 0) {
      guestParts.push(`${children} Child${children > 1 ? "ren" : ""}`);
    }
    if (infants > 0) {
      guestParts.push(`${infants} Infant${infants > 1 ? "s" : ""}`);
    }
    noteParts.push(`Guests: ${guestParts.join(", ")}`);
  }
  if (input.notes && input.notes.trim()) {
    noteParts.push(input.notes.trim());
  }
  const formattedNotes = noteParts.length > 0 ? noteParts.join(" | ") : undefined;

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
    availabilityId: resolvedAvailabilityId,
    ...(formattedNotes !== undefined ? { notes: formattedNotes } : {}),
    agentId: isAgent ? actorId : null,
    createdById: actorId,
    source: isAgent ? "AGENT" : "CUSTOMER",
    currency,
    basePrice,
    proposedPrice,
    finalPrice,
    status,
    requiresApproval,
  });

  if (requiresApproval && proposedPrice !== undefined) {
    await bookingRepository.createPriceApproval(booking.id, proposedPrice);
    const updated = await bookingRepository.findBookingById(booking.id);
    await notificationService.notifyBookingCreated(booking.id);
    return mapBookingToResponse(updated);
  }

  await notificationService.notifyBookingCreated(booking.id);
  return mapBookingToResponse(booking);
};

export const createStaffBooking = async (
  input: CreateStaffBookingInput,
  staffId: string
): Promise<BookingResponse> => {
  // 1. Resolve or create customer (does NOT send login invitation or create password credentials)
  const customer = await resolveOrCreateCustomer({
    customerId: input.customerId,
    customer: input.customer,
  });

  // 2. Fetch service and active standard pricing
  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    include: { pricing: true },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }
  if (service.status !== "PUBLISHED") {
    throw new AppError("Cannot book unpublished tour", 400);
  }

  const now = new Date();
  const activePricings = service.pricing.filter(
    (p) =>
      (!p.validFrom || p.validFrom <= now) && (!p.validTo || p.validTo >= now)
  );

  if (activePricings.length === 0) {
    throw new AppError("Service has no active pricing", 400);
  }

  if (activePricings.length > 1) {
    throw new AppError(
      "Service has multiple active pricing tiers. Please contact support.",
      409
    );
  }

  const activePricing = activePricings[0]!;
  const rawBasePrice = Number(activePricing.basePrice);
  const currency = activePricing.currency;

  const hasGuestCounts =
    input.adults !== undefined ||
    input.children !== undefined ||
    input.infants !== undefined;

  let basePrice = rawBasePrice;

  if (hasGuestCounts) {
    const adults = Math.max(1, Number(input.adults ?? 1));
    const children = Math.max(0, Number(input.children ?? 0));
    const infants = Math.max(0, Number(input.infants ?? 0));

    const unitAdultPrice =
      activePricing.discountedPrice != null &&
      Number(activePricing.discountedPrice) > 0
        ? Number(activePricing.discountedPrice)
        : rawBasePrice;

    const metadata = (service as any).metadata as Record<string, any> | null;
    const tiers: Array<{ tierName?: string; price?: number }> = Array.isArray(
      metadata?.pricingTiers
    )
      ? metadata!.pricingTiers
      : [];

    const childTier = tiers.find((t) =>
      /child/i.test(String(t?.tierName || ""))
    );
    const infantTier = tiers.find((t) =>
      /infant/i.test(String(t?.tierName || ""))
    );

    const unitChildPrice =
      childTier && typeof childTier.price === "number" && childTier.price >= 0
        ? Number(childTier.price)
        : Math.round(unitAdultPrice * 0.7 * 100) / 100;

    const unitInfantPrice =
      infantTier &&
      typeof infantTier.price === "number" &&
      infantTier.price >= 0
        ? Number(infantTier.price)
        : 0;

    basePrice =
      Math.round(
        (adults * unitAdultPrice +
          children * unitChildPrice +
          infants * unitInfantPrice) *
          100
      ) / 100;
  }

  const finalPrice = basePrice;
  const hasDiscount = Boolean(input.discount && input.discount.discountValue > 0);
  const requiresApproval = hasDiscount;
  const status = hasDiscount ? "AWAITING_APPROVAL" : "PENDING";

  let discountAmount = 0;
  let proposedFinalPrice = basePrice;

  if (hasDiscount && input.discount) {
    const dVal = Number(input.discount.discountValue);
    if (input.discount.discountType === "PERCENTAGE") {
      if (dVal <= 0 || dVal > 100) {
        throw new AppError("Percentage discount must be between 1 and 100", 400);
      }
      discountAmount = Math.round(basePrice * (dVal / 100) * 100) / 100;
    } else if (input.discount.discountType === "FIXED_AMOUNT") {
      if (dVal <= 0) {
        throw new AppError("Fixed discount must be greater than zero", 400);
      }
      if (dVal >= basePrice) {
        throw new AppError(
          `Fixed discount (${dVal}) must be strictly less than the standard original price (${basePrice})`,
          400
        );
      }
      discountAmount = Math.round(dVal * 100) / 100;
    } else {
      throw new AppError("Invalid discount type", 400);
    }

    proposedFinalPrice = Math.round((basePrice - discountAmount) * 100) / 100;
    if (proposedFinalPrice <= 0) {
      throw new AppError("Proposed final price after discount must be greater than zero", 400);
    }

    if (!input.discount.reason || !input.discount.reason.trim()) {
      throw new AppError("A reason is mandatory when requesting a discount", 400);
    }
  }

  // 3. Resolve Availability, Capacity Validation, Customer & Booking Creation atomically
  let travelDateObj: Date | undefined;
  if (input.travelDate && input.travelDate.trim()) {
    travelDateObj = new Date(input.travelDate.trim());
    if (isNaN(travelDateObj.getTime())) {
      throw new AppError("Invalid travel date format", 400);
    }
  }

  const totalGuests = Math.max(
    1,
    (input.adults ?? 1) + (input.children ?? 0) + (input.infants ?? 0)
  );

  // 4. Build Structured Notes
  const noteParts: string[] = [];
  if (input.travelDate && input.travelDate.trim()) {
    noteParts.push(`Travel Date: ${input.travelDate.trim()}`);
  }
  if (hasGuestCounts) {
    const adults = Math.max(1, Number(input.adults ?? 1));
    const children = Math.max(0, Number(input.children ?? 0));
    const infants = Math.max(0, Number(input.infants ?? 0));
    const guestParts: string[] = [`${adults} Adult${adults > 1 ? "s" : ""}`];
    if (children > 0) {
      guestParts.push(`${children} Child${children > 1 ? "ren" : ""}`);
    }
    if (infants > 0) {
      guestParts.push(`${infants} Infant${infants > 1 ? "s" : ""}`);
    }
    noteParts.push(`Guests: ${guestParts.join(", ")}`);
  }
  if (input.notes && input.notes.trim()) {
    noteParts.push(input.notes.trim());
  }
  const formattedNotes = noteParts.length > 0 ? noteParts.join(" | ") : undefined;

  // 5. Execute Customer, Availability Capacity, and Booking in a single atomic transaction
  const booking = await prisma.$transaction(async (tx) => {
    // 5a. Resolve or create customer inside transaction
    const customer = await resolveOrCreateCustomer(
      {
        customerId: input.customerId,
        customer: input.customer,
      },
      tx
    );

    // 5b. Resolve availability and reserve capacity atomically
    let resolvedAvailabilityId = input.availabilityId;

    if (travelDateObj) {
      // Upsert availability record if it does not exist yet to obtain record ID
      await tx.serviceAvailability.upsert({
        where: {
          serviceId_date: {
            serviceId: input.serviceId,
            date: travelDateObj,
          },
        },
        create: {
          serviceId: input.serviceId,
          date: travelDateObj,
          isAvailable: true,
          bookedCount: 0,
          lastVerifiedAt: new Date(),
        },
        update: {},
      });

      // Conditional atomic update: only increments if isAvailable is true and capacity is not exceeded
      const updatedList = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "ServiceAvailability"
        SET "bookedCount" = "bookedCount" + ${totalGuests},
            "lastVerifiedAt" = NOW()
        WHERE "serviceId" = ${input.serviceId}
          AND "date" = ${travelDateObj}::date
          AND "isAvailable" = true
          AND ("capacity" IS NULL OR "bookedCount" + ${totalGuests} <= "capacity")
        RETURNING "id"
      `;

      if (!updatedList || updatedList.length === 0) {
        // Find existing record to provide specific error message
        const currentAvail = await tx.serviceAvailability.findUnique({
          where: {
            serviceId_date: {
              serviceId: input.serviceId,
              date: travelDateObj,
            },
          },
          select: { isAvailable: true, capacity: true, bookedCount: true },
        });

        if (currentAvail && !currentAvail.isAvailable) {
          throw new AppError("Tour is not available on the selected date", 400);
        }
        throw new AppError("Selected date does not have sufficient capacity", 409);
      }

      resolvedAvailabilityId = updatedList[0].id;
    }

    // 5c. Persist Booking & Audit History
    const created = await bookingRepository.createBooking(
      {
        customerId: customer.id,
        agentId: null,
        createdById: staffId,
        source: "DIRECT",
        serviceId: input.serviceId,
        availabilityId: resolvedAvailabilityId,
        currency,
        basePrice,
        finalPrice,
        status,
        requiresApproval,
        ...(formattedNotes !== undefined ? { notes: formattedNotes } : {}),
        historyAction: "BOOKING_CREATED_BY_STAFF",
        actorRole: "staff",
      },
      tx
    );

    // 5d. Atomically persist StaffDiscountRequest and StaffDiscountAuditEvent if discount requested
    if (hasDiscount && input.discount) {
      const discountRecord = await tx.staffDiscountRequest.create({
        data: {
          bookingId: created.id,
          discountType: input.discount.discountType,
          discountValue: input.discount.discountValue,
          originalPrice: basePrice,
          discountAmount,
          proposedFinalPrice,
          status: "PENDING",
          reason: input.discount.reason.trim(),
          requestedById: staffId,
        },
      });

      const staffUser = await tx.user.findUnique({
        where: { id: staffId },
        select: { id: true, role: true },
      });

      await tx.staffDiscountAuditEvent.create({
        data: {
          discountRequestId: discountRecord.id,
          bookingId: created.id,
          actorId: staffId,
          actorRole: staffUser?.role || "staff",
          action: "DISCOUNT_REQUESTED",
          previousStatus: null,
          newStatus: "PENDING",
          originalPrice: basePrice,
          discountType: input.discount.discountType,
          discountValue: input.discount.discountValue,
          requestedDiscountAmount: discountAmount,
          proposedFinalPrice,
          reason: input.discount.reason.trim(),
          metadata: {
            currency,
            source: "STAFF_DIRECT_CREATION",
          },
        },
      });
    }

    return created;
  });

  // Only notify customer on creation if the booking does NOT require approval
  if (!requiresApproval) {
    await notificationService.notifyBookingCreated(booking.id);
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

  const result = await prisma.$transaction(async (tx) => {
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

    if (tx.bookingHistory) {
      await tx.bookingHistory.create({
        data: {
          bookingId,
          actorId,
          actorRole: "agent",
          action: requiresApproval ? "PRICE_APPROVAL_REQUESTED" : "PRICE_UPDATED",
          changes: {
            previousStatus: booking.status,
            newStatus: status,
            previousPrice: Number(booking.finalPrice),
            proposedPrice,
            requiresApproval,
          },
        },
      });
    }

    return mapBookingToResponse(updated);
  });

  await notificationService.notifyBookingStatusChanged(bookingId);
  return result;
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
    await notificationService.notifyBookingStatusChanged(bookingId);
    return mapBookingToResponse(updated);
  }

  const rejected = await bookingRepository.rejectPriceApproval(
    bookingId,
    adminId,
    input.notes,
  );
  await notificationService.notifyBookingStatusChanged(bookingId);
  return mapBookingToResponse(rejected);
};

export const listAdminPendingReservations = async (
  query: Record<string, unknown>
) => {
  const { page, limit, skip } = parsePagination(query);
  const search = typeof query.search === "string" ? query.search : undefined;
  const paymentStatus =
    typeof query.paymentStatus === "string" ? query.paymentStatus : undefined;

  const { items, total } = await bookingRepository.listPendingReservations({
    skip,
    take: limit,
    search,
    paymentStatus,
  });

  return { items, page, limit, total };
};

export const listStaffCreatedBookings = async (
  staffId: string,
  query: Record<string, unknown>
) => {
  const { page, limit, skip } = parsePagination(query);
  const result = await bookingRepository.listStaffCreatedBookings(staffId, {
    skip,
    take: limit,
    status: typeof query.status === "string" ? query.status : undefined,
    paymentStatus: typeof query.paymentStatus === "string" ? query.paymentStatus : undefined,
    fulfillmentStatus: typeof query.fulfillmentStatus === "string" ? query.fulfillmentStatus : undefined,
    search: typeof query.search === "string" ? query.search : undefined,
  });

  return {
    items: result.items,
    page,
    limit,
    total: result.total,
  };
};

export const getAdminPendingReservation = async (bookingId: string) => {
  const booking = await bookingRepository.findPendingReservationById(bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }
  return booking;
};

export const reviewPendingReservation = async (
  bookingId: string,
  input: ReviewPendingBookingInput,
  adminId: string
) => {
  if (input.action === "CONFIRM") {
    try {
      const updated = await bookingRepository.confirmPendingBooking({
        bookingId,
        adminId,
        notes: input.notes,
        approvedDiscountValue: input.approvedDiscountValue,
      });
      if (!updated) {
        throw new AppError("Booking not found", 404);
      }
      await notificationService.notifyBookingStatusChanged(bookingId);
      return updated;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(err.message || "Failed to confirm booking", 400);
    }
  }

  try {
    const updated = await bookingRepository.rejectPendingBooking({
      bookingId,
      adminId,
      notes: input.notes,
      rejectionReason: input.rejectionReason,
    });
    if (!updated) {
      throw new AppError("Booking not found", 404);
    }
    await notificationService.notifyBookingStatusChanged(bookingId);
    return updated;
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw new AppError(err.message || "Failed to reject booking", 400);
  }
};

export const getAdminBookingHistory = async (
  bookingId: string,
  query: Record<string, unknown>
) => {
  const { page, limit, skip } = parsePagination({ limit: 50, ...query });
  const result = await bookingRepository.findBookingHistory({
    bookingId,
    skip,
    take: limit,
  });

  if (!result) {
    throw new AppError("Booking not found", 404);
  }

  return {
    items: result.items,
    page,
    limit,
    total: result.total,
  };
};

export const getStaffBookingHistory = async (
  staffId: string,
  bookingId: string,
  query: Record<string, unknown>
) => {
  const { page, limit, skip } = parsePagination({ limit: 50, ...query });
  const result = await bookingRepository.findBookingHistory({
    bookingId,
    skip,
    take: limit,
    assignedStaffId: staffId,
  });

  if (!result) {
    throw new AppError("Booking not found", 404);
  }

  return {
    items: result.items,
    page,
    limit,
    total: result.total,
  };
};

export const getAgentBookingHistory = async (
  agentId: string,
  bookingId: string,
  query: Record<string, unknown>
) => {
  const { page, limit, skip } = parsePagination({ limit: 50, ...query });
  const result = await bookingRepository.findBookingHistory({
    bookingId,
    skip,
    take: limit,
    agentId,
  });

  if (!result) {
    throw new AppError("Booking not found", 404);
  }

  return {
    items: result.items,
    page,
    limit,
    total: result.total,
  };
};

export const listStaffCustomers = async (query: Record<string, unknown>) => {
  return bookingRepository.listStaffCustomers(query);
};

