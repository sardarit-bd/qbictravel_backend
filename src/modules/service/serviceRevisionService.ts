import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import { updateServiceRecord } from "./serviceRepository.js";

export interface DraftRevisionValidationResult {
  isValid: boolean;
  errors: string[];
}

export const validateDraftRevisionData = (draftData: Record<string, any>): DraftRevisionValidationResult => {
  const errors: string[] = [];

  if (!draftData || typeof draftData !== "object") {
    return { isValid: false, errors: ["Draft data must be an object"] };
  }

  const name = typeof draftData.name === "string" ? draftData.name.trim() : "";
  if (name.length < 3) {
    errors.push("Tour name must be at least 3 characters");
  }

  if (Array.isArray(draftData.packages) && draftData.packages.length > 0) {
    for (let i = 0; i < draftData.packages.length; i++) {
      const pkg = draftData.packages[i];
      if (!pkg?.name || String(pkg.name).trim().length === 0) {
        errors.push(`Option #${i + 1} is missing a name`);
      }
      const price = Number(pkg?.sellingPrice);
      if (!Number.isFinite(price) || price < 0) {
        errors.push(`Option #${i + 1} has an invalid base price`);
      }
    }
  }

  return { isValid: errors.length === 0, errors };
};

export const getOrCreateActiveRevision = async (serviceId: string, actorId?: string) => {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      pricing: true,
      packages: { orderBy: { sortOrder: "asc" } },
      timeSlots: { orderBy: { sortOrder: "asc" } },
      pickupZones: { orderBy: { sortOrder: "asc" } },
      pickupAssignments: { include: { pickupZone: true }, orderBy: { sortOrder: "asc" } },
      availability: { orderBy: { date: "asc" } },
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  const existingActive = await prisma.serviceDraftRevision.findFirst({
    where: { serviceId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
  });

  if (existingActive) {
    return existingActive;
  }

  const initialSnapshot = {
    name: service.name,
    description: service.description,
    type: service.type,
    pricingType: service.pricingType,
    providerName: service.providerName,
    providerId: service.providerId,
    metadata: service.metadata ?? {},
    packages: service.packages.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      durationMinutes: p.durationMinutes,
      boatSize: p.boatSize,
      minPax: p.minPax,
      maxCapacity: p.maxCapacity,
      sellingPrice: Number(p.sellingPrice),
      netPrice: p.netPrice != null ? Number(p.netPrice) : null,
      currency: p.currency,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
    })),
    timeSlots: service.timeSlots.map((s) => ({
      id: s.id,
      name: s.name,
      departureTime: s.departureTime,
      capacity: s.capacity,
      isActive: s.isActive,
      sortOrder: s.sortOrder,
    })),
    pickupZones: service.pickupZones.map((z) => ({
      id: z.id,
      zoneName: z.zoneName,
      description: z.description,
      morningPickupTime: z.morningPickupTime,
      afternoonPickupTime: z.afternoonPickupTime,
      hasPrivateTransfer: z.hasPrivateTransfer,
      privateTransferCharge: z.privateTransferCharge != null ? Number(z.privateTransferCharge) : null,
      surchargeAmount: Number(z.surchargeAmount),
      surchargeUnit: z.surchargeUnit,
      currency: z.currency,
      isActive: z.isActive,
      sortOrder: z.sortOrder,
    })),
    pickupAssignments: service.pickupAssignments.map((a) => ({
      pickupZoneId: a.pickupZoneId,
      morningPickupTimeOverride: a.morningPickupTimeOverride,
      afternoonPickupTimeOverride: a.afternoonPickupTimeOverride,
      surchargeOverride: a.surchargeOverride != null ? Number(a.surchargeOverride) : null,
      privateTransferChargeOverride:
        a.privateTransferChargeOverride != null ? Number(a.privateTransferChargeOverride) : null,
      isActive: a.isActive,
      sortOrder: a.sortOrder,
    })),
  };

  return prisma.serviceDraftRevision.create({
    data: {
      serviceId,
      draftData: initialSnapshot as any,
      version: 1,
      baseServiceVersion: service.version,
      status: "ACTIVE",
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
};

export const saveDraftRevision = async (
  serviceId: string,
  revisionId: string,
  input: {
    draftData: Record<string, any>;
    expectedVersion: number;
    actorId?: string;
  }
) => {
  const revision = await prisma.serviceDraftRevision.findFirst({
    where: { id: revisionId, serviceId },
  });

  if (!revision) {
    throw new AppError("Draft revision not found", 404);
  }

  if (revision.status !== "ACTIVE") {
    throw new AppError(`Draft revision is ${revision.status} and cannot be edited`, 409);
  }

  if (revision.version !== input.expectedVersion) {
    const err = new AppError(
      `Revision version conflict: expected ${input.expectedVersion}, current is ${revision.version}`,
      409
    );
    (err as any).latestRevision = revision;
    throw err;
  }

  return prisma.serviceDraftRevision.update({
    where: { id: revisionId },
    data: {
      draftData: input.draftData as any,
      version: { increment: 1 },
      updatedById: input.actorId ?? null,
    },
  });
};

export const discardDraftRevision = async (
  serviceId: string,
  revisionId: string,
  actorId?: string
) => {
  const revision = await prisma.serviceDraftRevision.findFirst({
    where: { id: revisionId, serviceId },
  });

  if (!revision) {
    throw new AppError("Draft revision not found", 404);
  }

  return prisma.serviceDraftRevision.update({
    where: { id: revisionId },
    data: {
      status: "DISCARDED",
      updatedById: actorId ?? null,
    },
  });
};

export const publishDraftRevision = async (
  serviceId: string,
  revisionId: string,
  input: {
    expectedVersion?: number;
    expectedServiceVersion?: number;
    actorId?: string;
  }
) => {
  const revision = await prisma.serviceDraftRevision.findFirst({
    where: { id: revisionId, serviceId },
  });

  if (!revision) {
    throw new AppError("Draft revision not found", 404);
  }

  if (revision.status !== "ACTIVE") {
    throw new AppError(`Draft revision is ${revision.status} and cannot be published`, 409);
  }

  if (input.expectedVersion !== undefined && revision.version !== input.expectedVersion) {
    throw new AppError(
      `Revision version conflict: expected ${input.expectedVersion}, current is ${revision.version}`,
      409
    );
  }

  const draftData = (revision.draftData || {}) as Record<string, any>;
  const validation = validateDraftRevisionData(draftData);
  if (!validation.isValid) {
    throw new AppError(`Draft revision failed validation: ${validation.errors.join("; ")}`, 400);
  }

  const updatedService = await updateServiceRecord(serviceId, {
    name: draftData.name,
    description: draftData.description,
    type: draftData.type,
    status: "PUBLISHED",
    pricingType: draftData.pricingType,
    providerName: draftData.providerName,
    providerId: draftData.providerId,
    metadata: draftData.metadata,
    pricing: draftData.pricing,
    availability: draftData.availability,
    packages: draftData.packages,
    timeSlots: draftData.timeSlots,
    pickupZones: draftData.pickupZones,
    expectedVersion: input.expectedServiceVersion ?? revision.baseServiceVersion,
    updatedById: input.actorId,
  });

  if (Array.isArray(draftData.pickupAssignments)) {
    await setServicePickupAssignments(serviceId, draftData.pickupAssignments);
  }

  await prisma.serviceDraftRevision.update({
    where: { id: revisionId },
    data: {
      status: "APPLIED",
      updatedById: input.actorId ?? null,
    },
  });

  return updatedService;
};

export const archiveService = async (serviceId: string, actorId?: string) => {
  const existing = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!existing) {
    throw new AppError("Service not found", 404);
  }

  return prisma.service.update({
    where: { id: serviceId },
    data: {
      archivedAt: new Date(),
      updatedById: actorId ?? null,
    },
  });
};

export const restoreService = async (serviceId: string, actorId?: string) => {
  const existing = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!existing) {
    throw new AppError("Service not found", 404);
  }

  return prisma.service.update({
    where: { id: serviceId },
    data: {
      archivedAt: null,
      updatedById: actorId ?? null,
    },
  });
};

export interface PickupAssignmentInput {
  pickupZoneId: string;
  morningPickupTimeOverride?: string | null;
  afternoonPickupTimeOverride?: string | null;
  surchargeOverride?: number | null;
  privateTransferChargeOverride?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}

export const listGlobalPickupZones = async () => {
  return prisma.pickupZone.findMany({
    where: { serviceId: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { zoneName: "asc" }],
  });
};

export const setServicePickupAssignments = async (
  serviceId: string,
  assignments: PickupAssignmentInput[]
) => {
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } });
  if (!service) {
    throw new AppError("Service not found", 404);
  }

  return prisma.$transaction(async (tx) => {
    const incomingZoneIds = new Set(assignments.map((a) => a.pickupZoneId));

    // Remove assignments no longer in list
    await tx.servicePickupZoneAssignment.deleteMany({
      where: {
        serviceId,
        pickupZoneId: { notIn: Array.from(incomingZoneIds) },
      },
    });

    const results = [];
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      const upserted = await tx.servicePickupZoneAssignment.upsert({
        where: {
          serviceId_pickupZoneId: {
            serviceId,
            pickupZoneId: a.pickupZoneId,
          },
        },
        update: {
          morningPickupTimeOverride: a.morningPickupTimeOverride ?? null,
          afternoonPickupTimeOverride: a.afternoonPickupTimeOverride ?? null,
          surchargeOverride: a.surchargeOverride ?? null,
          privateTransferChargeOverride: a.privateTransferChargeOverride ?? null,
          isActive: a.isActive ?? true,
          sortOrder: a.sortOrder ?? i,
        },
        create: {
          serviceId,
          pickupZoneId: a.pickupZoneId,
          morningPickupTimeOverride: a.morningPickupTimeOverride ?? null,
          afternoonPickupTimeOverride: a.afternoonPickupTimeOverride ?? null,
          surchargeOverride: a.surchargeOverride ?? null,
          privateTransferChargeOverride: a.privateTransferChargeOverride ?? null,
          isActive: a.isActive ?? true,
          sortOrder: a.sortOrder ?? i,
        },
        include: { pickupZone: true },
      });
      results.push(upserted);
    }

    return results;
  });
};
