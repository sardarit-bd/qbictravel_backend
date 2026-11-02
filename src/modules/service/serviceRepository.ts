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
  ServicePricingSummary,
  ServiceAvailabilitySummary,
  BulkUpdateServiceStatusInput,
  BulkUpdateServiceStatusResult,
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
      media: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!result) return null;

  // Map the nested pricing array to convert Decimal to number
  return {
    ...result,
    pricing: result.pricing.map(mapPricingRecord),
  } as ServiceDetail;
};

import { Prisma } from "../../../generated/prisma/client.js";

export const computePricingSummary = (pricingRecords?: any[]): ServicePricingSummary | null => {
  if (!pricingRecords || pricingRecords.length === 0) return null;
  const latest = pricingRecords[0];
  return {
    currency: latest.currency,
    basePrice: typeof latest.basePrice === "number" ? latest.basePrice : latest.basePrice.toNumber(),
    discountedPrice: latest.discountedPrice
      ? (typeof latest.discountedPrice === "number" ? latest.discountedPrice : latest.discountedPrice.toNumber())
      : null,
    taxRate: typeof latest.taxRate === "number" ? latest.taxRate : latest.taxRate.toNumber(),
    validFrom: latest.validFrom,
    validTo: latest.validTo,
  };
};

export const computeAvailabilitySummary = (availabilityRecords?: any[]): ServiceAvailabilitySummary | null => {
  if (!availabilityRecords || availabilityRecords.length === 0) return null;
  let availableCount = 0;
  let unavailableCount = 0;
  let totalCapacity = 0;
  let hasCapacity = false;
  let totalBooked = 0;

  for (const av of availabilityRecords) {
    if (av.isAvailable) availableCount++;
    else unavailableCount++;
    if (av.capacity !== null && av.capacity !== undefined) {
      totalCapacity += av.capacity;
      hasCapacity = true;
    }
    totalBooked += av.bookedCount || 0;
  }

  return {
    availableDateCount: availableCount,
    unavailableDateCount: unavailableCount,
    totalCapacity: hasCapacity ? totalCapacity : null,
    bookedCount: totalBooked,
  };
};

export const findAdminServices = async (
  query: GetServicesQuery
): Promise<PaginatedResult<ServiceRecord>> => {
  const page = Math.max(1, query.page || 1);
  const limit = Math.max(1, Math.min(100, query.limit || 10));
  const skip = (page - 1) * limit;

  const searchTerm = (query.search || query.q || "").trim();

  if (searchTerm) {
    const searchPhrase = searchTerm;
    const fullPattern = `%${searchTerm}%`;
    const prefixPattern = `${searchTerm}%`;
    const words = searchTerm.split(/\s+/).filter(Boolean);

    const filterClauses: Prisma.Sql[] = [];
    if (query.type) {
      filterClauses.push(Prisma.sql`s.type = ${query.type}::"ServiceType"`);
    }
    if (query.status) {
      filterClauses.push(Prisma.sql`s.status = ${query.status}::"ServiceStatus"`);
    }

    const wordMatchClauses = words.map((w) => {
      const pattern = `%${w}%`;
      return Prisma.sql`(
        s."name" ILIKE ${pattern} OR
        COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '') ILIKE ${pattern} OR
        COALESCE(s."providerName", '') ILIKE ${pattern} OR
        COALESCE(s.description, '') ILIKE ${pattern}
      )`;
    });

    const wordSimilarityClauses = words.map((w) => {
      return Prisma.sql`(
        word_similarity(${w}, s."name") > 0.3 OR
        word_similarity(${w}, COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '')) > 0.3 OR
        word_similarity(${w}, COALESCE(s."providerName", '')) > 0.3
      )`;
    });

    const searchPredicate = Prisma.sql`
      (
        s."name" ILIKE ${fullPattern} OR
        COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '') ILIKE ${fullPattern} OR
        COALESCE(s."providerName", '') ILIKE ${fullPattern} OR
        COALESCE(s.description, '') ILIKE ${fullPattern} OR
        word_similarity(${searchPhrase}, s."name") > 0.25 OR
        word_similarity(${searchPhrase}, COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '')) > 0.25 OR
        word_similarity(${searchPhrase}, COALESCE(s."providerName", '')) > 0.25 OR
        similarity(s."name", ${searchPhrase}) > 0.15 OR
        ${Prisma.join(wordMatchClauses, " OR ")}
        ${wordSimilarityClauses.length > 0 ? Prisma.sql` OR ${Prisma.join(wordSimilarityClauses, " OR ")}` : Prisma.empty}
      )
    `;

    const allWhere = [searchPredicate, ...filterClauses];
    const whereSql = Prisma.sql`WHERE ${Prisma.join(allWhere, " AND ")}`;

    const scoreExpr = Prisma.sql`
      (
        (CASE WHEN LOWER(s."name") = LOWER(${searchPhrase}) THEN 100.0 ELSE 0.0 END) +
        (CASE WHEN LOWER(COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '')) = LOWER(${searchPhrase}) THEN 60.0 ELSE 0.0 END) +
        (CASE WHEN LOWER(COALESCE(s."providerName", '')) = LOWER(${searchPhrase}) THEN 40.0 ELSE 0.0 END) +
        (CASE WHEN s."name" ILIKE ${prefixPattern} THEN 50.0 ELSE 0.0 END) +
        (CASE WHEN COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '') ILIKE ${prefixPattern} THEN 30.0 ELSE 0.0 END) +
        (CASE WHEN COALESCE(s."providerName", '') ILIKE ${prefixPattern} THEN 20.0 ELSE 0.0 END) +
        (CASE WHEN s."name" ILIKE ${fullPattern} THEN 30.0 ELSE 0.0 END) +
        (CASE WHEN COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '') ILIKE ${fullPattern} THEN 20.0 ELSE 0.0 END) +
        (CASE WHEN COALESCE(s."providerName", '') ILIKE ${fullPattern} THEN 15.0 ELSE 0.0 END) +
        (CASE WHEN COALESCE(s.description, '') ILIKE ${fullPattern} THEN 10.0 ELSE 0.0 END) +
        (word_similarity(${searchPhrase}, s."name") * 40.0) +
        (word_similarity(${searchPhrase}, COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', '')) * 25.0) +
        (word_similarity(${searchPhrase}, COALESCE(s."providerName", '')) * 15.0) +
        (word_similarity(${searchPhrase}, COALESCE(s.description, '')) * 10.0) +
        (similarity(s."name", ${searchPhrase}) * 20.0) +
        (similarity(COALESCE(s.metadata->>'destination', s.metadata->>'destinationCategory', s.metadata->'location'->>'city', ''), ${searchPhrase}) * 15.0) +
        (similarity(COALESCE(s."providerName", ''), ${searchPhrase}) * 10.0) +
        (similarity(COALESCE(s.description, ''), ${searchPhrase}) * 5.0)
      )
    `;

    const sortBy = query.sortBy || "relevance";
    const sortOrder = query.sortOrder || (sortBy === "name" ? "asc" : "desc");

    let orderSql: Prisma.Sql;
    if (sortBy === "name") {
      orderSql = sortOrder === "desc" ? Prisma.sql`ORDER BY s."name" DESC, s."updatedAt" DESC` : Prisma.sql`ORDER BY s."name" ASC, s."updatedAt" DESC`;
    } else if (sortBy === "createdAt") {
      orderSql = sortOrder === "asc" ? Prisma.sql`ORDER BY s."createdAt" ASC` : Prisma.sql`ORDER BY s."createdAt" DESC`;
    } else if (sortBy === "status") {
      orderSql = sortOrder === "asc" ? Prisma.sql`ORDER BY s."status" ASC, s."updatedAt" DESC` : Prisma.sql`ORDER BY s."status" DESC, s."updatedAt" DESC`;
    } else if (sortBy === "updatedAt") {
      orderSql = sortOrder === "asc" ? Prisma.sql`ORDER BY s."updatedAt" ASC` : Prisma.sql`ORDER BY s."updatedAt" DESC`;
    } else {
      orderSql = sortOrder === "asc" ? Prisma.sql`ORDER BY relevance_score ASC, s."updatedAt" DESC` : Prisma.sql`ORDER BY relevance_score DESC, s."updatedAt" DESC`;
    }

    const [countResult, rawItems] = await Promise.all([
      db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count
        FROM "Service" s
        ${whereSql}
      `,
      db.$queryRaw<any[]>`
        SELECT s.*, ${scoreExpr} AS relevance_score
        FROM "Service" s
        ${whereSql}
        ${orderSql}
        LIMIT ${limit} OFFSET ${skip}
      `,
    ]);

    const total = Number(countResult[0]?.count || 0);
    const itemIds = rawItems.map((r) => r.id);

    const [pricingRecords, availabilityRecords] = itemIds.length > 0
      ? await Promise.all([
          db.servicePricing.findMany({
            where: { serviceId: { in: itemIds } },
            orderBy: { validFrom: "desc" },
          }),
          db.serviceAvailability.findMany({
            where: { serviceId: { in: itemIds } },
          }),
        ])
      : [[], []];

    const items: ServiceRecord[] = rawItems.map((item) => {
      const itemPricing = pricingRecords.filter((p) => p.serviceId === item.id);
      const itemAvailability = availabilityRecords.filter((a) => a.serviceId === item.id);

      return {
        id: item.id,
        name: item.name,
        description: item.description,
        type: item.type,
        status: item.status,
        providerName: item.providerName,
        providerId: item.providerId,
        metadata: item.metadata,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        relevanceScore: typeof item.relevance_score === "number" ? Math.round(item.relevance_score * 100) / 100 : undefined,
        pricingSummary: computePricingSummary(itemPricing),
        availabilitySummary: computeAvailabilitySummary(itemAvailability),
      };
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Non-search path
  const where: any = {};
  if (query.type) {
    where.type = query.type;
  }
  if (query.status) {
    where.status = query.status;
  }

  const sortBy = query.sortBy && query.sortBy !== "relevance" ? query.sortBy : "updatedAt";
  const sortOrder = query.sortOrder || (sortBy === "name" ? "asc" : "desc");
  const orderBy: any = { [sortBy]: sortOrder };

  const [dbItems, total] = await Promise.all([
    db.service.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        pricing: { orderBy: { validFrom: "desc" } },
        availability: true,
      },
    }),
    db.service.count({ where }),
  ]);

  const items: ServiceRecord[] = dbItems.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type,
    status: item.status,
    providerName: item.providerName,
    providerId: item.providerId,
    metadata: item.metadata,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    pricingSummary: computePricingSummary(item.pricing),
    availabilitySummary: computeAvailabilitySummary(item.availability),
  }));

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

export const bulkUpdateServiceStatus = async (
  data: BulkUpdateServiceStatusInput
): Promise<BulkUpdateServiceStatusResult> => {
  const { serviceIds, status } = data;

  return db.$transaction(async (tx) => {
    const existing = await tx.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true },
    });

    const foundIds = existing.map((s) => s.id);
    const notFoundIds = serviceIds.filter((id) => !foundIds.includes(id));

    if (foundIds.length > 0) {
      await tx.service.updateMany({
        where: { id: { in: foundIds } },
        data: { status },
      });
    }

    return {
      updatedCount: foundIds.length,
      requestedCount: serviceIds.length,
      updatedIds: foundIds,
      notFoundIds,
      status,
    };
  });
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