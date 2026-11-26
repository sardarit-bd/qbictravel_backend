import AppError from "../../shared/utils/AppError.js";
import { prisma } from "../../lib/prisma.js";
import * as bookingRepository from "./bookingRepository.js";
import * as pricingService from "../pricing/pricingService.js";
import * as notificationService from "../notification/notificationService.js";
import { parsePagination } from "../../shared/utils/pagination.js";
import { generateSecureToken, hashToken } from "../payment/tokenUtils.js";
import { enqueueOutboxMessage } from "../outbox/outboxService.js";
import { emitBookingEvent } from "../event/eventEmitter.js";
import logger from "../../shared/logger/logger.js";
import type {
  CreateBookingInput,
  CreateStaffBookingInput,
  CreateGuestBookingInput,
  GuestBookingResult,
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
    packagePriceSnapshot:
      booking.packagePriceSnapshot != null ? Number(booking.packagePriceSnapshot) : null,
    netPriceSnapshot:
      booking.netPriceSnapshot != null ? Number(booking.netPriceSnapshot) : null,
    pickupSurcharge: Number(booking.pickupSurcharge ?? 0),
    taxAmount: Number(booking.taxAmount ?? 0),
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

export interface PricingEvaluationResult {
  currency: string;
  basePrice: number;
  finalPrice: number;
  packagePriceSnapshot: number | null;
  netPriceSnapshot: number | null;
  pickupSurcharge: number;
  taxAmount: number;
  departureTime: string | null;
  pickupLocation: string | null;
  packageId: string | null;
  packageQuantity: number;
  timeSlotId: string | null;
  pickupZoneId: string | null;
}

export const evaluateBookingPricing = async (
  serviceId: string,
  input: {
    packageId?: string | null;
    packageQuantity?: number;
    timeSlotId?: string | null;
    pickupZoneId?: string | null;
    departureTime?: string | null;
    pickupLocation?: string | null;
    isPrivateTransfer?: boolean;
    adults?: number;
    children?: number;
    infants?: number;
  }
): Promise<PricingEvaluationResult> => {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      pricing: true,
      packages: true,
      timeSlots: true,
      pickupZones: true,
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  const adults = Math.max(1, Number(input.adults ?? 1));
  const children = Math.max(0, Number(input.children ?? 0));
  const infants = Math.max(0, Number(input.infants ?? 0));
  const totalPassengers = adults + children + infants;

  // 1. Validate & resolve TimeSlot if provided
  let resolvedDepartureTime = input.departureTime?.trim() || null;
  let resolvedTimeSlotId: string | null = null;
  if (input.timeSlotId) {
    const slot = service.timeSlots.find((s) => s.id === input.timeSlotId);
    if (!slot) {
      throw new AppError("Selected departure session does not belong to this service", 400);
    }
    if (!slot.isActive) {
      throw new AppError("Selected departure session is inactive", 400);
    }
    resolvedTimeSlotId = slot.id;
    if (!resolvedDepartureTime) {
      resolvedDepartureTime = slot.departureTime;
    }
  }

  // 2. Validate & resolve PickupZone if provided
  let pickupSurcharge = 0;
  let resolvedPickupZoneId: string | null = null;
  if (input.pickupZoneId) {
    const zone = service.pickupZones.find((z) => z.id === input.pickupZoneId);
    if (!zone) {
      throw new AppError("Selected pickup zone does not belong to this service", 400);
    }
    if (!zone.isActive) {
      throw new AppError("Selected pickup zone is inactive", 400);
    }
    resolvedPickupZoneId = zone.id;

    if (input.isPrivateTransfer) {
      if (!zone.hasPrivateTransfer) {
        throw new AppError("Private transfer is not available for this pickup zone", 400);
      }
      pickupSurcharge = Number(zone.privateTransferCharge ?? 1600);
    } else {
      const stdCharge = Number(zone.surchargeAmount ?? 0);
      if (zone.surchargeUnit === "PER_PERSON") {
        // Enforce minimum 2 persons rule for surcharge zones with min 2 pax requirement
        const isMin2PaxZone = /layan|paklok|yamu|ao por|naithon|airport|naiyang|maikhao/i.test(zone.zoneName || "");
        const chargedPax = isMin2PaxZone ? Math.max(2, totalPassengers) : totalPassengers;
        pickupSurcharge = stdCharge * chargedPax;
      } else {
        // PER_BOOKING, PER_VEHICLE, etc.
        pickupSurcharge = stdCharge;
      }
    }
  }

  let resolvedPickupLocation = input.pickupLocation?.trim() || null;

  // 3. Package-based (PER_PACKAGE) vs Per-person (PER_PERSON) calculation
  const isElephantService =
    service.pricingType === "PER_PERSON" ||
    (service as any).metadata?.editorType === "SIREY_ELEPHANTS" ||
    /elephant/i.test(service.name || "");

  if (input.packageId || service.pricingType === "PER_PACKAGE") {
    if (!input.packageId) {
      throw new AppError("A package selection is required for package-priced tours", 400);
    }
    const pkg = service.packages.find((p) => p.id === input.packageId);
    if (!pkg) {
      throw new AppError("Selected package does not belong to this service", 400);
    }
    if (!pkg.isActive) {
      throw new AppError("Selected package is currently inactive", 400);
    }

    const packageQuantity = Math.max(
      1,
      Math.min(20, Math.floor(Number(input.packageQuantity ?? 1)) || 1)
    );
    const effectiveMaxCapacity = pkg.maxCapacity * packageQuantity;

    // Capacity validation
    if (totalPassengers > effectiveMaxCapacity) {
      throw new AppError(
        `Selected package accommodates a maximum of ${effectiveMaxCapacity} passengers (${totalPassengers} requested)`,
        400
      );
    }
    if (totalPassengers < pkg.minPax) {
      throw new AppError(
        `Selected package requires at least ${pkg.minPax} passenger (${totalPassengers} requested)`,
        400
      );
    }

    const packagePrice = Number(pkg.sellingPrice);
    const netPrice = pkg.netPrice != null ? Number(pkg.netPrice) : null;
    const currency = pkg.currency || "THB";

    // If this is a PER_PERSON package tour (such as Sirey Elephants Program 1 or Program 2)
    const hasGuestCounts =
      input.adults !== undefined || input.children !== undefined || input.infants !== undefined;

    let computedBasePrice = Math.round(packagePrice * packageQuantity * 100) / 100;
    const computedNetPrice =
      netPrice != null ? Math.round(netPrice * packageQuantity * 100) / 100 : null;

    if (service.pricingType === "PER_PERSON" && hasGuestCounts) {
      const metadata = (service as any).metadata as Record<string, any> | null;
      const programs = Array.isArray(metadata?.programs) ? metadata!.programs : [];
      const progMeta = programs.find((p: any) => p.id === pkg.id || p.name === pkg.name);

      const adultRate = Number(pkg.sellingPrice);
      let childRate = progMeta && typeof progMeta.childPrice === "number" ? Number(progMeta.childPrice) : adultRate;
      if (!progMeta && /program 2|bathe/i.test(pkg.name)) {
        childRate = 2500;
      } else if (!progMeta && /program 1|feed/i.test(pkg.name)) {
        childRate = 900;
      }
      const infantRate = 0;

      computedBasePrice =
        Math.round((adults * adultRate + children * childRate + infants * infantRate) * 100) / 100;
    }

    // Tax calculation (if service pricing specifies taxRate, e.g. 7% VAT)
    let taxRate = 0;
    const now = new Date();
    const activePricing = service.pricing.find(
      (p) => (!p.validFrom || p.validFrom <= now) && (!p.validTo || p.validTo >= now)
    );
    if (activePricing) {
      taxRate = Number(activePricing.taxRate ?? 0);
    }

    const subtotal = Math.round((computedBasePrice + pickupSurcharge) * 100) / 100;
    const taxAmount = taxRate > 0 ? Math.round(((subtotal * taxRate) / 100) * 100) / 100 : 0;
    const finalPrice = Math.round((subtotal + taxAmount) * 100) / 100;

    return {
      currency,
      basePrice: subtotal,
      finalPrice,
      packagePriceSnapshot: packagePrice,
      netPriceSnapshot: service.pricingType === "PER_PERSON" ? netPrice : computedNetPrice,
      pickupSurcharge,
      taxAmount,
      departureTime: resolvedDepartureTime,
      pickupLocation: resolvedPickupLocation,
      packageId: pkg.id,
      packageQuantity: service.pricingType === "PER_PERSON" ? 1 : packageQuantity,
      timeSlotId: resolvedTimeSlotId,
      pickupZoneId: resolvedPickupZoneId,
    };
  }

  // 4. Default Legacy: Per-Person Pricing
  const now = new Date();
  const activePricings = service.pricing.filter(
    (p) => (!p.validFrom || p.validFrom <= now) && (!p.validTo || p.validTo >= now)
  );

  if (activePricings.length === 0) {
    throw new AppError("Service has no active pricing", 400);
  }

  if (activePricings.length > 1) {
    throw new AppError("Service has multiple active pricing tiers. Please contact support.", 409);
  }

  const activePricing = activePricings[0]!;
  const rawBasePrice = Number(activePricing.basePrice);
  const currency = activePricing.currency;

  const hasGuestCounts =
    input.adults !== undefined || input.children !== undefined || input.infants !== undefined;

  let basePrice = rawBasePrice;

  if (hasGuestCounts) {
    const unitAdultPrice =
      activePricing.discountedPrice != null && Number(activePricing.discountedPrice) > 0
        ? Number(activePricing.discountedPrice)
        : rawBasePrice;

    const metadata = (service as any).metadata as Record<string, any> | null;
    const tiers: Array<{ tierName?: string; price?: number }> = Array.isArray(metadata?.pricingTiers)
      ? metadata!.pricingTiers
      : [];

    const childTier = tiers.find((t) => /child/i.test(String(t?.tierName || "")));
    const infantTier = tiers.find((t) => /infant/i.test(String(t?.tierName || "")));

    const unitChildPrice =
      childTier && typeof childTier.price === "number" && childTier.price >= 0
        ? Number(childTier.price)
        : Math.round(unitAdultPrice * 0.7 * 100) / 100;

    const unitInfantPrice =
      infantTier && typeof infantTier.price === "number" && infantTier.price >= 0
        ? Number(infantTier.price)
        : 0;

    basePrice =
      Math.round(
        (adults * unitAdultPrice + children * unitChildPrice + infants * unitInfantPrice) * 100
      ) / 100;
  }

  const subtotal = Math.round((basePrice + pickupSurcharge) * 100) / 100;
  const taxRate = Number(activePricing.taxRate ?? 0);
  const taxAmount = taxRate > 0 ? Math.round(((subtotal * taxRate) / 100) * 100) / 100 : 0;
  const finalPrice = Math.round((subtotal + taxAmount) * 100) / 100;

  return {
    currency,
    basePrice: subtotal,
    finalPrice,
    packagePriceSnapshot: null,
    netPriceSnapshot: null,
    pickupSurcharge,
    taxAmount,
    departureTime: resolvedDepartureTime,
    pickupLocation: resolvedPickupLocation,
    packageId: null,
    packageQuantity: 1,
    timeSlotId: resolvedTimeSlotId,
    pickupZoneId: resolvedPickupZoneId,
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

  // Authoritatively evaluate pricing (handles PER_PACKAGE & PER_PERSON)
  const evalPricing = await evaluateBookingPricing(input.serviceId, {
    packageId: input.packageId,
    packageQuantity: input.packageQuantity,
    timeSlotId: input.timeSlotId,
    pickupZoneId: input.pickupZoneId,
    departureTime: input.departureTime,
    pickupLocation: input.pickupLocation,
    isPrivateTransfer: input.isPrivateTransfer,
    adults: input.adults,
    children: input.children,
    infants: input.infants,
  });

  const basePrice = evalPricing.basePrice;
  const currency = evalPricing.currency;

  let finalPrice = evalPricing.finalPrice;
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
  const hasGuestCounts =
    input.adults !== undefined ||
    input.children !== undefined ||
    input.infants !== undefined;

  const noteParts: string[] = [];
  if (input.travelDate && input.travelDate.trim()) {
    noteParts.push(`Travel Date: ${input.travelDate.trim()}`);
  }
  if (evalPricing.departureTime) {
    noteParts.push(`Departure: ${evalPricing.departureTime}`);
  }
  if (evalPricing.pickupLocation) {
    noteParts.push(`Pickup: ${evalPricing.pickupLocation}`);
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
    packageId: evalPricing.packageId,
    packageQuantity: evalPricing.packageQuantity,
    timeSlotId: evalPricing.timeSlotId,
    pickupZoneId: evalPricing.pickupZoneId,
    departureTime: evalPricing.departureTime,
    pickupLocation: evalPricing.pickupLocation,
    packagePriceSnapshot: evalPricing.packagePriceSnapshot,
    netPriceSnapshot: evalPricing.netPriceSnapshot,
    pickupSurcharge: evalPricing.pickupSurcharge,
    taxAmount: evalPricing.taxAmount,
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
    emitBookingEvent("booking.created", booking.id).catch((err) =>
      logger.error({ bookingId: booking.id, err }, "Failed to emit booking.created event")
    );
    return mapBookingToResponse(updated);
  }

  await notificationService.notifyBookingCreated(booking.id);
  emitBookingEvent("booking.created", booking.id).catch((err) =>
    logger.error({ bookingId: booking.id, err }, "Failed to emit booking.created event")
  );
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

  // Authoritatively evaluate pricing
  const evalPricing = await evaluateBookingPricing(input.serviceId, {
    packageId: input.packageId,
    packageQuantity: input.packageQuantity,
    timeSlotId: input.timeSlotId,
    pickupZoneId: input.pickupZoneId,
    departureTime: input.departureTime,
    pickupLocation: input.pickupLocation,
    isPrivateTransfer: input.isPrivateTransfer,
    adults: input.adults,
    children: input.children,
    infants: input.infants,
  });

  const basePrice = evalPricing.basePrice;
  const currency = evalPricing.currency;

  const hasGuestCounts =
    input.adults !== undefined ||
    input.children !== undefined ||
    input.infants !== undefined;

  const hasDiscount = Boolean(input.discount && input.discount.discountValue > 0);
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

  // Staff can create bookings directly without waiting for Admin approval
  const finalPrice = hasDiscount ? proposedFinalPrice : evalPricing.finalPrice;
  const requiresApproval = false;
  const status = "CONFIRMED";

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
  if (evalPricing.departureTime) {
    noteParts.push(`Departure: ${evalPricing.departureTime}`);
  }
  if (evalPricing.pickupLocation) {
    noteParts.push(`Pickup: ${evalPricing.pickupLocation}`);
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
    const resolvedCustomer = await resolveOrCreateCustomer(
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
        customerId: resolvedCustomer.id,
        agentId: null,
        createdById: staffId,
        assignedStaffId: staffId,
        source: "DIRECT",
        serviceId: input.serviceId,
        availabilityId: resolvedAvailabilityId,
        packageId: evalPricing.packageId,
        packageQuantity: evalPricing.packageQuantity,
        timeSlotId: evalPricing.timeSlotId,
        pickupZoneId: evalPricing.pickupZoneId,
        departureTime: evalPricing.departureTime,
        pickupLocation: evalPricing.pickupLocation,
        packagePriceSnapshot: evalPricing.packagePriceSnapshot,
        netPriceSnapshot: evalPricing.netPriceSnapshot,
        pickupSurcharge: evalPricing.pickupSurcharge,
        taxAmount: evalPricing.taxAmount,
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

    // 5d. Atomically persist StaffDiscountRequest and StaffDiscountAuditEvent if discount applied
    if (hasDiscount && input.discount) {
      const discountRecord = await tx.staffDiscountRequest.create({
        data: {
          bookingId: created.id,
          discountType: input.discount.discountType,
          discountValue: input.discount.discountValue,
          originalPrice: basePrice,
          discountAmount,
          proposedFinalPrice,
          approvedDiscountAmount: discountAmount,
          approvedFinalPrice: proposedFinalPrice,
          status: "APPROVED",
          reason: input.discount.reason.trim(),
          requestedById: staffId,
          reviewedById: staffId,
          reviewedAt: new Date(),
          adminNotes: "Direct staff discount applied at booking creation",
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
          action: "DISCOUNT_APPROVED",
          previousStatus: null,
          newStatus: "APPROVED",
          originalPrice: basePrice,
          discountType: input.discount.discountType,
          discountValue: input.discount.discountValue,
          requestedDiscountAmount: discountAmount,
          proposedFinalPrice,
          approvedDiscountAmount: discountAmount,
          finalPrice: proposedFinalPrice,
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
  emitBookingEvent("booking.created", booking.id).catch((err) =>
    logger.error({ bookingId: booking.id, err }, "Failed to emit booking.created event")
  );
  return mapBookingToResponse(booking);
};

export const createGuestBooking = async (
  input: CreateGuestBookingInput
): Promise<GuestBookingResult> => {
  // 1. Fetch tour service and active standard pricing
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

  // Authoritatively evaluate pricing
  const evalPricing = await evaluateBookingPricing(input.serviceId, {
    packageId: input.packageId,
    packageQuantity: input.packageQuantity,
    timeSlotId: input.timeSlotId,
    pickupZoneId: input.pickupZoneId,
    departureTime: input.departureTime,
    pickupLocation: input.pickupLocation,
    isPrivateTransfer: input.isPrivateTransfer,
    adults: input.adults,
    children: input.children,
    infants: input.infants,
  });

  const basePrice = evalPricing.basePrice;
  const currency = evalPricing.currency;
  const finalPrice = evalPricing.finalPrice;
  const status = "PENDING";
  const requiresApproval = false;

  const hasGuestCounts =
    input.adults !== undefined ||
    input.children !== undefined ||
    input.infants !== undefined;

  // 2. Parse travel date
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

  // 3. Build structured notes
  const noteParts: string[] = [];
  if (input.travelDate && input.travelDate.trim()) {
    noteParts.push(`Travel Date: ${input.travelDate.trim()}`);
  }
  if (evalPricing.departureTime) {
    noteParts.push(`Departure: ${evalPricing.departureTime}`);
  }
  if (evalPricing.pickupLocation) {
    noteParts.push(`Pickup: ${evalPricing.pickupLocation}`);
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

  // Generate tokens
  const rawAccessToken = generateSecureToken();
  const accessTokenHash = hashToken(rawAccessToken);
  const tokenExpiresAt = new Date();
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30); // 30-day guest token

  const rawPaymentToken = generateSecureToken();
  const paymentTokenHash = hashToken(rawPaymentToken);
  const paymentExpiresAt = new Date();
  paymentExpiresAt.setDate(paymentExpiresAt.getDate() + 7); // 7-day payment link

  const normalizedEmail = input.customer.email.trim().toLowerCase();
  const normalizedName = input.customer.name.trim();
  const normalizedPhone = input.customer.phone?.trim() || null;

  // 4. Atomic transaction
  const result = await prisma.$transaction(async (tx) => {
    // 4a. Resolve or create shadow customer
    const customer = await resolveOrCreateCustomer(
      {
        customer: {
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
        },
      },
      tx
    );

    // 4b. Capacity reservation
    let resolvedAvailabilityId = input.availabilityId;
    if (travelDateObj) {
      const defaultCapacity = (service as any).capacity || 50;
      await tx.$executeRaw`
        INSERT INTO "ServiceAvailability" ("id", "serviceId", "date", "capacity", "bookedCount", "isAvailable", "lastVerifiedAt")
        VALUES (gen_random_uuid(), ${input.serviceId}, ${travelDateObj}, ${defaultCapacity}, 0, true, NOW())
        ON CONFLICT ("serviceId", "date") DO NOTHING;
      `;

      const updatedList: any[] = await tx.$queryRaw`
        UPDATE "ServiceAvailability"
        SET "bookedCount" = "bookedCount" + ${totalGuests},
            "lastVerifiedAt" = NOW()
        WHERE "serviceId" = ${input.serviceId}
          AND "date" = ${travelDateObj}
          AND "isAvailable" = true
          AND ("capacity" - "bookedCount") >= ${totalGuests}
        RETURNING "id", "bookedCount", "capacity";
      `;

      if (!updatedList || updatedList.length === 0) {
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

    // 4c. Create Booking
    const booking = await bookingRepository.createBooking(
      {
        customerId: customer.id,
        agentId: null,
        createdById: null, // Explicitly NULL for anonymous guest checkout
        source: "DIRECT",
        serviceId: input.serviceId,
        availabilityId: resolvedAvailabilityId,
        packageId: evalPricing.packageId,
        packageQuantity: evalPricing.packageQuantity,
        timeSlotId: evalPricing.timeSlotId,
        pickupZoneId: evalPricing.pickupZoneId,
        departureTime: evalPricing.departureTime,
        pickupLocation: evalPricing.pickupLocation,
        packagePriceSnapshot: evalPricing.packagePriceSnapshot,
        netPriceSnapshot: evalPricing.netPriceSnapshot,
        pickupSurcharge: evalPricing.pickupSurcharge,
        taxAmount: evalPricing.taxAmount,
        currency,
        basePrice,
        finalPrice,
        status,
        requiresApproval,
        ...(formattedNotes !== undefined ? { notes: formattedNotes } : {}),
        historyAction: "BOOKING_CREATED_BY_GUEST",
        actorRole: "customer",
        isGuest: true,
      },
      tx
    );

    // 4d. Create immutable GuestBookingSnapshot
    await tx.guestBookingSnapshot.create({
      data: {
        bookingId: booking.id,
        guestName: normalizedName,
        guestEmail: normalizedEmail,
        guestPhone: normalizedPhone,
      },
    });

    // 4e. Create GuestBookingToken
    await tx.guestBookingToken.create({
      data: {
        bookingId: booking.id,
        tokenHash: accessTokenHash,
        email: normalizedEmail,
        purpose: "ACCESS_AND_CLAIM",
        expiresAt: tokenExpiresAt,
      },
    });

    // 4f. Create active PaymentLink
    await tx.paymentLink.create({
      data: {
        bookingId: booking.id,
        tokenHash: paymentTokenHash,
        expiresAt: paymentExpiresAt,
        status: "ACTIVE",
        createdById: null,
      },
    });

    return {
      booking: mapBookingToResponse(booking),
      guestSnapshot: {
        guestName: normalizedName,
        guestEmail: normalizedEmail,
        guestPhone: normalizedPhone,
      },
      accessToken: rawAccessToken,
      rawPaymentToken,
    };
  });

  const frontendBaseUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  const paymentUrl = `${frontendBaseUrl}/pay/${result.rawPaymentToken}`;
  const guestAccessUrl = `${frontendBaseUrl}/bookings/guest/${result.accessToken}`;

  // Enqueue Guest Booking Access Email via Transactional Outbox
  try {
    await enqueueOutboxMessage(prisma, {
      topic: "SEND_BOOKING_VOUCHER_EMAIL",
      payload: {
        bookingId: result.booking.id,
        isGuestAccess: true,
        guestAccessUrl,
        guestTokenExpiresAt: tokenExpiresAt.toISOString(),
      },
      dedupeKey: `guest_access_email:${result.booking.id}`,
    });
  } catch (err) {
    logger.error({ bookingId: result.booking.id, err }, "Failed to enqueue guest access outbox email");
  }

  emitBookingEvent("booking.created", result.booking.id).catch((err) =>
    logger.error({ bookingId: result.booking.id, err }, "Failed to emit booking.created event")
  );

  return {
    booking: result.booking,
    guestSnapshot: result.guestSnapshot,
    accessToken: result.accessToken,
    guestAccessUrl,
    paymentLink: {
      token: result.rawPaymentToken,
      paymentUrl,
    },
  };
};

/**
 * Retrieves public safe guest booking itinerary details using a secure magic-link token.
 * Validates token expiration, revocation, and active purpose.
 * Never leaks internal customer IDs, Shadow Customer credentials, or private internal notes.
 */
export const getPublicGuestBookingDetails = async (rawToken: string) => {
  const tokenHash = hashToken(rawToken);
  const tokenRecord = await bookingRepository.findGuestBookingTokenByHash(tokenHash);

  if (!tokenRecord) {
    throw new AppError("Invalid or expired booking access link", 404);
  }

  // Security checks: revocation & expiration
  if (tokenRecord.revokedAt) {
    throw new AppError("This booking access link has been revoked", 403);
  }

  if (new Date() > new Date(tokenRecord.expiresAt)) {
    throw new AppError("This booking access link has expired", 410);
  }

  const booking = tokenRecord.booking;
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }

  const finalPrice = Number(booking.finalPrice);
  const verifiedPayments = booking.payments || [];
  const totalPaid = verifiedPayments.reduce(
    (sum: number, p: any) => sum + Number(p.amount),
    0,
  );
  const remainingBalance = Math.max(0, finalPrice - totalPaid);

  // Check if active payment link exists and is still valid
  const activePaymentLink = booking.paymentLinks?.[0];
  const isPaymentLinkValid =
    activePaymentLink &&
    activePaymentLink.status === "ACTIVE" &&
    new Date() < new Date(activePaymentLink.expiresAt) &&
    remainingBalance > 0 &&
    booking.paymentStatus !== "PAID";

  const frontendBaseUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

  // Parse structured notes for guest count details (e.g. "Guests: 2 Adults, 1 Child")
  let guestCounts = { adults: 1, children: 0, infants: 0 };
  if (booking.notes) {
    const matchAdults = booking.notes.match(/(\d+)\s+Adult/i);
    const matchChildren = booking.notes.match(/(\d+)\s+Child/i);
    const matchInfants = booking.notes.match(/(\d+)\s+Infant/i);
    if (matchAdults) guestCounts.adults = parseInt(matchAdults[1], 10);
    if (matchChildren) guestCounts.children = parseInt(matchChildren[1], 10);
    if (matchInfants) guestCounts.infants = parseInt(matchInfants[1], 10);
  }

  // Construct safe, sanitized response payload
  return {
    bookingReference: booking.id.substring(0, 8).toUpperCase(),
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    fulfillmentStatus: booking.fulfillmentStatus,
    currency: booking.currency,
    pricing: {
      basePrice: Number(booking.basePrice),
      finalPrice: finalPrice,
      totalPaid: totalPaid,
      remainingBalance: remainingBalance,
    },
    guest: {
      name: booking.guestSnapshot?.guestName || "Guest",
      email: booking.guestSnapshot?.guestEmail || tokenRecord.email,
      phone: booking.guestSnapshot?.guestPhone || null,
      party: guestCounts,
    },
    service: {
      id: booking.service.id,
      name: booking.service.name,
      type: booking.service.type,
      description: booking.service.description,
      providerName: booking.service.providerName,
      metadata: booking.service.metadata,
    },
    travelDate: booking.availability?.date
      ? new Date(booking.availability.date).toISOString().split("T")[0]
      : null,
    createdAt: booking.createdAt,
    paymentAction: isPaymentLinkValid
      ? {
          isPayable: true,
          expiresAt: activePaymentLink.expiresAt,
          paymentUrl: `${frontendBaseUrl}/pay/${activePaymentLink.tokenHash}`, // Note: in production, paymentLink tokenHash or lookup token
        }
      : {
          isPayable: false,
          remainingBalance: remainingBalance,
        },
    cancellationPolicy: {
      allowed: false,
      notice: "Direct online cancellations are not permitted for guest bookings. Please contact support to modify or cancel your reservation.",
      supportEmail: "support@phukettours.com",
    },
  };
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
    emitBookingEvent("booking.approved", bookingId, { approvedPrice: Number(input.approvedPrice) }).catch((err) =>
      logger.error({ bookingId, err }, "Failed to emit booking.approved event")
    );
    return mapBookingToResponse(updated);
  }

  const rejected = await bookingRepository.rejectPriceApproval(
    bookingId,
    adminId,
    input.notes,
  );
  await notificationService.notifyBookingStatusChanged(bookingId);
  emitBookingEvent("booking.rejected", bookingId).catch((err) =>
    logger.error({ bookingId, err }, "Failed to emit booking.rejected event")
  );
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
  const scope = query.scope === "all" ? "all" : "my";
  const result = await bookingRepository.listStaffCreatedBookings(staffId, {
    skip,
    take: limit,
    scope,
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
      emitBookingEvent("booking.approved", bookingId).catch((err) =>
        logger.error({ bookingId, err }, "Failed to emit booking.approved event")
      );
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
    emitBookingEvent("booking.rejected", bookingId).catch((err) =>
      logger.error({ bookingId, err }, "Failed to emit booking.rejected event")
    );
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

export const amendStaffBooking = async (
  bookingId: string,
  input: {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string | null;
    travelDate?: string;
    packageId?: string;
    packageQuantity?: number;
    timeSlotId?: string;
    pickupZoneId?: string;
    isPrivateTransfer?: boolean;
    adults?: number;
    children?: number;
    infants?: number;
    pickupLocation?: string;
    departureTime?: string;
    notes?: string;
    discount?: {
      discountType: "PERCENTAGE" | "FIXED_AMOUNT";
      discountValue: number;
      reason: string;
    };
  },
  actorId: string,
  actorRole: string
) => {
  // 1. Fetch existing booking
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      service: {
        include: {
          pricing: true,
          packages: true,
          timeSlots: true,
          pickupZones: true,
        },
      },
      availability: { select: { id: true, date: true } },
      package: true,
      timeSlot: true,
      pickupZone: true,
      payments: { where: { status: "VERIFIED" } },
    },
  });

  if (!existing) {
    throw new AppError("Booking not found", 404);
  }

  if (existing.status === "CANCELLED" || existing.status === "FAILED") {
    throw new AppError("Cannot amend a cancelled or failed booking", 409);
  }

  // Parse existing notes to preserve existing metadata if not modified
  const rawNotes = existing.notes || "";
  let oldAdults = 1;
  let oldChildren = 0;
  let oldInfants = 0;
  let oldTravelDate: string | null = null;
  let oldPickup: string | null = existing.pickupLocation || null;

  const notesSegments = rawNotes.split(" | ");
  for (const seg of notesSegments) {
    if (seg.startsWith("Travel Date: ")) {
      oldTravelDate = seg.replace("Travel Date: ", "").trim();
    } else if (seg.startsWith("Guests: ")) {
      const gStr = seg.replace("Guests: ", "");
      const aMatch = gStr.match(/(\d+)\s*Adult/i);
      const cMatch = gStr.match(/(\d+)\s*Child/i);
      const iMatch = gStr.match(/(\d+)\s*Infant/i);
      if (aMatch) oldAdults = parseInt(aMatch[1], 10);
      if (cMatch) oldChildren = parseInt(cMatch[1], 10);
      if (iMatch) oldInfants = parseInt(iMatch[1], 10);
    } else if (seg.startsWith("Pickup: ")) {
      oldPickup = seg.replace("Pickup: ", "").trim();
    }
  }

  const effectiveAdults = input.adults !== undefined ? input.adults : oldAdults;
  const effectiveChildren = input.children !== undefined ? input.children : oldChildren;
  const effectiveInfants = input.infants !== undefined ? input.infants : oldInfants;
  const effectiveTravelDate = input.travelDate !== undefined ? input.travelDate : oldTravelDate;
  const effectivePickup = input.pickupLocation !== undefined ? input.pickupLocation : oldPickup;

  // Validate travel date format if given
  let travelDateObj: Date | undefined;
  if (effectiveTravelDate && effectiveTravelDate.trim()) {
    travelDateObj = new Date(effectiveTravelDate.trim());
    if (isNaN(travelDateObj.getTime())) {
      throw new AppError("Invalid travel date format", 400);
    }
  }

  // Calculate guest deltas for capacity check
  const oldTotalGuests = Math.max(1, oldAdults + oldChildren + oldInfants);
  const newTotalGuests = Math.max(1, effectiveAdults + effectiveChildren + effectiveInfants);
  const guestDelta = newTotalGuests - oldTotalGuests;

  // Check if this tour utilizes package pricing / slots / pickup zones
  const isPackageBasedOrConfigured =
    Boolean(input.packageId) ||
    Boolean(existing.packageId) ||
    existing.service.pricingType === "PER_PACKAGE" ||
    (existing.service.packages && existing.service.packages.length > 0) ||
    Boolean(input.pickupZoneId) ||
    Boolean(existing.pickupZoneId);

  let newBasePrice = 0;
  let evalPackageDetails: any = null;

  if (isPackageBasedOrConfigured) {
    const targetPackageId = input.packageId !== undefined ? input.packageId : (existing.packageId || undefined);
    const targetPackageQuantity =
      input.packageQuantity !== undefined
        ? input.packageQuantity
        : ((existing as any).packageQuantity ?? 1);
    const targetTimeSlotId = input.timeSlotId !== undefined ? input.timeSlotId : (existing.timeSlotId || undefined);
    const targetPickupZoneId = input.pickupZoneId !== undefined ? input.pickupZoneId : (existing.pickupZoneId || undefined);

    const evalPricing = await evaluateBookingPricing(existing.serviceId, {
      packageId: targetPackageId,
      packageQuantity: targetPackageQuantity,
      timeSlotId: targetTimeSlotId,
      pickupZoneId: targetPickupZoneId,
      departureTime: input.departureTime || existing.departureTime || undefined,
      pickupLocation: effectivePickup || undefined,
      isPrivateTransfer: input.isPrivateTransfer,
      adults: effectiveAdults,
      children: effectiveChildren,
      infants: effectiveInfants,
    });

    newBasePrice = evalPricing.basePrice;
    evalPackageDetails = evalPricing;
  } else {
    // Default standard per-person pricing calculation
    const now = new Date();
    const activePricings = (existing.service.pricing || []).filter(
      (p: any) => (!p.validFrom || p.validFrom <= now) && (!p.validTo || p.validTo >= now)
    );

    const activePricing = activePricings[0] || (existing.service.pricing && existing.service.pricing[0]);
    if (!activePricing) {
      throw new AppError("Tour service has no pricing rules configured", 400);
    }

    const rawBasePrice = Number(activePricing.basePrice);
    const unitAdultPrice =
      activePricing.discountedPrice != null && Number(activePricing.discountedPrice) > 0
        ? Number(activePricing.discountedPrice)
        : rawBasePrice;

    const metadata = (existing.service as any).metadata as Record<string, any> | null;
    const tiers: Array<{ tierName?: string; price?: number }> = Array.isArray(metadata?.pricingTiers)
      ? metadata!.pricingTiers
      : [];
    const childTier = tiers.find((t) => /child/i.test(String(t?.tierName || "")));
    const infantTier = tiers.find((t) => /infant/i.test(String(t?.tierName || "")));

    const unitChildPrice =
      childTier && typeof childTier.price === "number" && childTier.price >= 0
        ? Number(childTier.price)
        : Math.round(unitAdultPrice * 0.7 * 100) / 100;

    const unitInfantPrice =
      infantTier && typeof infantTier.price === "number" && infantTier.price >= 0
        ? Number(infantTier.price)
        : 0;

    newBasePrice =
      Math.round((effectiveAdults * unitAdultPrice + effectiveChildren * unitChildPrice + effectiveInfants * unitInfantPrice) * 100) / 100;
  }

  let discountData: any = undefined;
  let newFinalPrice = newBasePrice;

  if (input.discount && input.discount.discountValue > 0) {
    const dVal = Number(input.discount.discountValue);
    let discountAmount = 0;
    if (input.discount.discountType === "PERCENTAGE") {
      if (dVal <= 0 || dVal > 100) {
        throw new AppError("Percentage discount must be between 1 and 100", 400);
      }
      discountAmount = Math.round(newBasePrice * (dVal / 100) * 100) / 100;
    } else if (input.discount.discountType === "FIXED_AMOUNT") {
      if (dVal <= 0) {
        throw new AppError("Fixed discount must be greater than zero", 400);
      }
      if (dVal >= newBasePrice) {
        throw new AppError(`Fixed discount (${dVal}) must be strictly less than base price (${newBasePrice})`, 400);
      }
      discountAmount = Math.round(dVal * 100) / 100;
    }

    newFinalPrice = Math.round((newBasePrice - discountAmount) * 100) / 100;
    if (newFinalPrice <= 0) {
      throw new AppError("Final price after discount must be greater than zero", 400);
    }
    discountData = {
      discountType: input.discount.discountType,
      discountValue: dVal,
      discountAmount,
      reason: input.discount.reason,
    };
  }

  // Re-build structured notes
  const noteParts: string[] = [];
  if (effectiveTravelDate && effectiveTravelDate.trim()) {
    noteParts.push(`Travel Date: ${effectiveTravelDate.trim()}`);
  }
  const guestParts: string[] = [`${effectiveAdults} Adult${effectiveAdults > 1 ? "s" : ""}`];
  if (effectiveChildren > 0) guestParts.push(`${effectiveChildren} Child${effectiveChildren > 1 ? "ren" : ""}`);
  if (effectiveInfants > 0) guestParts.push(`${effectiveInfants} Infant${effectiveInfants > 1 ? "s" : ""}`);
  noteParts.push(`Guests: ${guestParts.join(", ")}`);

  if (effectivePickup && effectivePickup.trim()) {
    noteParts.push(`Pickup: ${effectivePickup.trim()}`);
  }
  const resolvedDepartureTime = evalPackageDetails?.departureTime || input.departureTime || existing.departureTime;
  if (resolvedDepartureTime && resolvedDepartureTime.trim()) {
    noteParts.push(`Departure: ${resolvedDepartureTime.trim()}`);
  }
  if (input.notes && input.notes.trim()) {
    noteParts.push(input.notes.trim());
  }
  const formattedNotes = noteParts.join(" | ");

  // Collect changes for audit trail
  const changes: Record<string, any> = {
    previousBasePrice: Number(existing.basePrice),
    newBasePrice,
    previousFinalPrice: Number(existing.finalPrice),
    newFinalPrice,
  };

  if (input.customerName || input.customerEmail || input.customerPhone !== undefined) {
    changes.customer = {
      name: { from: existing.customer?.name, to: input.customerName ?? existing.customer?.name },
      email: { from: existing.customer?.email, to: input.customerEmail ?? existing.customer?.email },
      phone: { from: existing.customer?.phone, to: input.customerPhone !== undefined ? input.customerPhone : existing.customer?.phone },
    };
  }
  if (guestDelta !== 0) {
    changes.guests = {
      from: { adults: oldAdults, children: oldChildren, infants: oldInfants },
      to: { adults: effectiveAdults, children: effectiveChildren, infants: effectiveInfants },
    };
  }
  if (travelDateObj && existing.availability?.date && travelDateObj.getTime() !== new Date(existing.availability.date).getTime()) {
    changes.travelDate = {
      from: existing.availability.date,
      to: travelDateObj,
    };
  }
  if (effectivePickup !== oldPickup) {
    changes.pickupLocation = { from: oldPickup, to: effectivePickup };
  }
  if (evalPackageDetails?.packageId && evalPackageDetails.packageId !== existing.packageId) {
    changes.package = { from: existing.packageId, to: evalPackageDetails.packageId };
  }
  if (evalPackageDetails?.timeSlotId && evalPackageDetails.timeSlotId !== existing.timeSlotId) {
    changes.timeSlot = { from: existing.timeSlotId, to: evalPackageDetails.timeSlotId };
  }
  if (evalPackageDetails?.pickupZoneId && evalPackageDetails.pickupZoneId !== existing.pickupZoneId) {
    changes.pickupZone = { from: existing.pickupZoneId, to: evalPackageDetails.pickupZoneId };
  }
  if (discountData) {
    changes.discount = discountData;
  }

  try {
    const updated = await bookingRepository.amendBookingRecord({
      bookingId,
      actorId,
      actorRole,
      previousBooking: {
        ...existing,
        adults: oldAdults,
        children: oldChildren,
        infants: oldInfants,
      },
      service: existing.service,
      customerUpdates: {
        name: input.customerName,
        email: input.customerEmail,
        phone: input.customerPhone,
      },
      travelDateObj,
      guestDelta,
      adults: effectiveAdults,
      children: effectiveChildren,
      infants: effectiveInfants,
      newBasePrice,
      newFinalPrice,
      formattedNotes,
      packageId: evalPackageDetails?.packageId !== undefined ? evalPackageDetails.packageId : undefined,
      packageQuantity: evalPackageDetails?.packageQuantity !== undefined ? evalPackageDetails.packageQuantity : undefined,
      timeSlotId: evalPackageDetails?.timeSlotId !== undefined ? evalPackageDetails.timeSlotId : undefined,
      pickupZoneId: evalPackageDetails?.pickupZoneId !== undefined ? evalPackageDetails.pickupZoneId : undefined,
      departureTime: resolvedDepartureTime || undefined,
      pickupLocation: effectivePickup || undefined,
      pickupSurcharge: evalPackageDetails?.pickupSurcharge !== undefined ? evalPackageDetails.pickupSurcharge : undefined,
      taxAmount: evalPackageDetails?.taxAmount !== undefined ? evalPackageDetails.taxAmount : undefined,
      packagePriceSnapshot: evalPackageDetails?.packagePriceSnapshot !== undefined ? evalPackageDetails.packagePriceSnapshot : undefined,
      netPriceSnapshot: evalPackageDetails?.netPriceSnapshot !== undefined ? evalPackageDetails.netPriceSnapshot : undefined,
      discountData,
      changes,
    });

    emitBookingEvent("booking.status_changed", bookingId, { action: "AMENDED" }).catch((err) =>
      logger.error({ bookingId, err }, "Failed to emit amendment event")
    );

    // Send customer in-app notification & change summary email
    void notificationService.notifyBookingAmended(bookingId, changes, {
      id: actorId,
      role: actorRole,
    });

    return mapBookingToResponse(updated);
  } catch (err: any) {
    if (err?.message === "CAPACITY_EXCEEDED") {
      throw new AppError("Selected date or passenger count exceeds tour capacity", 409);
    }
    throw err;
  }
};

export const cancelStaffBooking = async (
  bookingId: string,
  actorId: string,
  actorRole: string,
  reason?: string
) => {
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      availability: { select: { id: true, date: true } },
    },
  });

  if (!existing) {
    throw new AppError("Booking not found", 404);
  }

  if (existing.status === "CANCELLED" || existing.status === "FAILED") {
    throw new AppError("Booking is already cancelled or failed", 409);
  }

  // Parse notes for guests
  let adults = 1;
  let children = 0;
  let infants = 0;
  const gMatch = (existing.notes || "").match(/Guests:\s*([^|]+)/i);
  if (gMatch) {
    const aMatch = gMatch[1].match(/(\d+)\s*Adult/i);
    const cMatch = gMatch[1].match(/(\d+)\s*Child/i);
    const iMatch = gMatch[1].match(/(\d+)\s*Infant/i);
    if (aMatch) adults = parseInt(aMatch[1], 10);
    if (cMatch) children = parseInt(cMatch[1], 10);
    if (iMatch) infants = parseInt(iMatch[1], 10);
  }

  const updated = await bookingRepository.cancelBookingRecord({
    bookingId,
    actorId,
    actorRole,
    reason,
    previousBooking: {
      ...existing,
      adults,
      children,
      infants,
    },
  });

  emitBookingEvent("booking.status_changed", bookingId, { status: "CANCELLED" }).catch((err) =>
    logger.error({ bookingId, err }, "Failed to emit cancellation event")
  );

  return mapBookingToResponse(updated);
};

export const getAdminActivityHistory = async (query: Record<string, unknown>) => {
  const { page, limit, skip } = parsePagination({ limit: 50, ...query });

  let startDate: Date | undefined;
  if (typeof query.startDate === "string" && query.startDate.trim()) {
    startDate = new Date(query.startDate.trim());
    if (isNaN(startDate.getTime())) startDate = undefined;
  }

  let endDate: Date | undefined;
  if (typeof query.endDate === "string" && query.endDate.trim()) {
    endDate = new Date(query.endDate.trim());
    if (isNaN(endDate.getTime())) endDate = undefined;
  }

  const result = await bookingRepository.listAllBookingActivities({
    bookingId: typeof query.bookingId === "string" ? query.bookingId : undefined,
    actorId: typeof query.actorId === "string" ? query.actorId : undefined,
    action: typeof query.action === "string" ? query.action : undefined,
    search: typeof query.search === "string" ? query.search : undefined,
    startDate,
    endDate,
    skip,
    take: limit,
  });

  return {
    items: result.items,
    page,
    limit,
    total: result.total,
    totalPages: Math.ceil(result.total / limit),
  };
};


