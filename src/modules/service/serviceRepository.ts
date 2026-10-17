import { db } from "../../config/database/index.js";
import type {
  CreateServiceInput,
  UpdateServiceInput,
  UpdateServiceStatusInput,
  AvailabilityUpdateInput,
  PricingUpdateInput,
  GetServicesQuery,
  ServiceDetail,
  ServiceRecord,
  ServiceAvailabilityRecord,
  ServicePricingRecord,
} from "./serviceTypes.js";
import type { PaginatedResult } from "../../types/common.js";

/**
 * Helper to map Prisma's Decimal type to standard JS numbers 
 * to prevent ORM types from leaking into the service layer.
 */
const mapPricingRecord = (record: any): ServicePricingRecord => ({
  id: record.id,
  serviceId: record.serviceId,
  currency: record.currency,
  basePrice: record.basePrice.toNumber(),
  discountedPrice: record.discountedPrice ? record.discountedPrice.toNumber() : null,
  taxRate: record.taxRate.toNumber(),
  validFrom: record.validFrom,
  validTo: record.validTo,
});

export const findPublishedServices = async (
  query: GetServicesQuery
): Promise<PaginatedResult<ServiceRecord>> => {
  const page = query.page || 1;
  const limit = query.limit || 10;
  const skip = (page - 1) * limit;

  const where: any = { status: "PUBLISHED" };
  if (query.type) {
    where.type = query.type;
  }

  const [items, total] = await Promise.all([
    db.service.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    db.service.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const findServiceById = async (id: string, includeUnpublished = false): Promise<ServiceDetail | null> => {
  const where: any = { id };
  if (!includeUnpublished) {
    where.status = "PUBLISHED";
  }

  const result = await db.service.findUnique({
    where,
    include: {
      availability: { orderBy: { date: "asc" } },
      pricing: { orderBy: { validFrom: "asc" } },
    },
  });

  if (!result) return null;

  // Map the nested pricing array to convert Decimal to number
  return {
    ...result,
    pricing: result.pricing.map(mapPricingRecord),
  } as ServiceDetail;
};

export const findAdminServices = async (
  query: GetServicesQuery
): Promise<PaginatedResult<ServiceRecord>> => {
  const page = query.page || 1;
  const limit = query.limit || 10;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (query.type) {
    where.type = query.type;
  }

  const [items, total] = await Promise.all([
    db.service.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: "desc" },
    }),
    db.service.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const createServiceRecord = async (data: CreateServiceInput): Promise<ServiceRecord> => {
  return db.service.create({ data }) as Promise<ServiceRecord>;
};

export const updateServiceRecord = async (id: string, data: UpdateServiceInput): Promise<ServiceRecord> => {
  return db.service.update({ where: { id }, data }) as Promise<ServiceRecord>;
};

export const updateServiceStatusRecord = async (id: string, data: UpdateServiceStatusInput): Promise<ServiceRecord> => {
  return db.service.update({ where: { id }, data }) as Promise<ServiceRecord>;
};

export const upsertServiceAvailability = async (
  serviceId: string,
  data: AvailabilityUpdateInput
): Promise<ServiceAvailabilityRecord> => {
  const dateObj = new Date(data.date);
  return db.serviceAvailability.upsert({
    where: {
      serviceId_date: {
        serviceId,
        date: dateObj,
      },
    },
    update: {
      isAvailable: data.isAvailable,
      capacity: data.capacity,
      externalReferenceId: data.externalReferenceId,
      lastVerifiedAt: new Date(),
    },
    create: {
      serviceId,
      date: dateObj,
      isAvailable: data.isAvailable,
      capacity: data.capacity,
      externalReferenceId: data.externalReferenceId,
      lastVerifiedAt: new Date(),
    },
  }) as Promise<ServiceAvailabilityRecord>;
};

export const findServiceAvailability = async (serviceId: string): Promise<ServiceAvailabilityRecord[]> => {
  return db.serviceAvailability.findMany({
    where: { serviceId },
    orderBy: { date: "asc" },
  }) as Promise<ServiceAvailabilityRecord[]>;
};

export const upsertServicePricing = async (
  serviceId: string,
  data: PricingUpdateInput
): Promise<ServicePricingRecord> => {
  const existing = await db.servicePricing.findFirst({
    where: { serviceId },
    orderBy: { validFrom: "desc" },
  });

  if (existing) {
    const updated = await db.servicePricing.update({
      where: { id: existing.id },
      data: {
        currency: data.currency,
        basePrice: data.basePrice !== undefined ? data.basePrice : undefined,
        discountedPrice: data.discountedPrice,
        taxRate: data.taxRate !== undefined ? data.taxRate : undefined,
        validFrom: data.validFrom ? new Date(data.validFrom) : undefined,
        validTo: data.validTo ? new Date(data.validTo) : undefined,
      },
    });
    return mapPricingRecord(updated);
  }

  const created = await db.servicePricing.create({
    data: {
      serviceId,
      currency: data.currency || "USD",
      basePrice: data.basePrice || 0,
      discountedPrice: data.discountedPrice || null,
      taxRate: data.taxRate || 0,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validTo: data.validTo ? new Date(data.validTo) : null,
    },
  });
  return mapPricingRecord(created);
};

export const findServicePricing = async (serviceId: string): Promise<ServicePricingRecord[]> => {
  const records = await db.servicePricing.findMany({
    where: { serviceId },
    orderBy: { validFrom: "asc" },
  });
  
  // Map the array to convert Decimal to number
  return records.map(mapPricingRecord);
};

export const findAllAdminAvailability = async (serviceId?: string) => {
  const where = serviceId ? { serviceId } : {};
  return db.serviceAvailability.findMany({
    where,
    include: { service: { select: { name: true, type: true } } },
    orderBy: { date: "asc" },
  });
};