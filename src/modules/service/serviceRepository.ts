import { db } from "../../config/database/index.js";
import AppError from "../../shared/utils/AppError.js";
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
): Promise<any> => {
  const page = query.page || 1;
  const limit = query.limit || 12;
  const skip = (page - 1) * limit;

  // Base published condition
  const basePublishedWhere: any = { status: "PUBLISHED", archivedAt: null };
  if (query.type) {
    basePublishedWhere.type = query.type;
  }

  // Cloned where clause for active filters
  const where: any = { ...basePublishedWhere };

  // Search: match on name, description, or metadata (destination, tourType, providerName)
  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { description: { contains: term, mode: "insensitive" } },
      { providerName: { contains: term, mode: "insensitive" } },
      { metadata: { path: ["destination"], string_contains: term } },
      { metadata: { path: ["destinationCategory"], string_contains: term } },
      { metadata: { path: ["tourType"], string_contains: term } },
    ];
  }

  // Destination filtering: accepts single string or array of destinations / destinationCategories
  const rawDests = query.destinations || query.destination;
  if (rawDests) {
    const destArray = Array.isArray(rawDests) ? rawDests : [rawDests];
    const cleanedDests = destArray.map((d) => String(d).trim()).filter(Boolean);
    if (cleanedDests.length > 0) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: cleanedDests.flatMap((dest) => [
            { metadata: { path: ["destinationCategory"], string_contains: dest } },
            { metadata: { path: ["destination"], string_contains: dest } },
          ]),
        },
      ];
    }
  }

  // Price filtering
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const min = query.minPrice !== undefined ? Number(query.minPrice) : 0;
    const max = query.maxPrice !== undefined ? Number(query.maxPrice) : Number.MAX_SAFE_INTEGER;
    where.AND = [
      ...(where.AND || []),
      {
        pricing: {
          some: {
            basePrice: {
              gte: min,
              lte: max,
            },
          },
        },
      },
    ];
  }

  // Sort order determination
  let orderBy: any = { createdAt: "desc" };
  if (query.sortBy) {
    switch (query.sortBy) {
      case "price-asc":
        orderBy = { pricing: { _count: "asc" } }; // or custom sort in memory if needed
        break;
      case "price-desc":
        orderBy = { pricing: { _count: "desc" } };
        break;
      case "name":
        orderBy = { name: query.sortOrder === "desc" ? "desc" : "asc" };
        break;
      case "createdAt":
        orderBy = { createdAt: query.sortOrder === "asc" ? "asc" : "desc" };
        break;
      case "most-popular":
      default:
        orderBy = { createdAt: "desc" };
        break;
    }
  }

  // Concurrently fetch items, filtered count, total overall published count, and all published services for facets
  const [items, totalFiltered, totalPublishedCount, allPublishedForFacets] = await Promise.all([
    db.service.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        pricing: { orderBy: { validFrom: "desc" } },
      },
    }),
    db.service.count({ where }),
    db.service.count({ where: basePublishedWhere }),
    db.service.findMany({
      where: basePublishedWhere,
      select: {
        metadata: true,
        pricing: { select: { basePrice: true, currency: true } },
      },
    }),
  ]);

  // Compute dynamic destination facets and price range across all published tours
  const destCounts: Record<string, { count: number; label: string }> = {};
  let overallMinPrice = 0;
  let overallMaxPrice = 500;
  const prices: number[] = [];

  for (const s of allPublishedForFacets) {
    const meta = (s.metadata || {}) as Record<string, any>;
    const destCategory = meta.destinationCategory || meta.destination;
    const destLabel = meta.destination || meta.destinationCategory;
    if (destCategory && destLabel) {
      const key = String(destCategory).toLowerCase().replace(/\s+/g, "-");
      if (!destCounts[key]) {
        destCounts[key] = { count: 0, label: String(destLabel) };
      }
      destCounts[key].count += 1;
    }

    if (s.pricing && s.pricing.length > 0) {
      for (const p of s.pricing) {
        if (p.basePrice) {
          prices.push(Number(p.basePrice));
        }
      }
    }
  }

  if (prices.length > 0) {
    overallMinPrice = Math.min(...prices);
    overallMaxPrice = Math.max(...prices);
  }

  const destinationFacets = Object.entries(destCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([id, info]) => ({
      id,
      label: info.label,
      count: info.count,
    }));

  // Populate pricingSummary from the included pricing array.
  const records: ServiceRecord[] = items.map((item: any) => ({
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
  }));

  // In-memory sorting for price-asc and price-desc if requested
  if (query.sortBy === "price-asc") {
    records.sort((a, b) => {
      const pA = a.pricingSummary?.basePrice ?? Number.MAX_SAFE_INTEGER;
      const pB = b.pricingSummary?.basePrice ?? Number.MAX_SAFE_INTEGER;
      return pA - pB;
    });
  } else if (query.sortBy === "price-desc") {
    records.sort((a, b) => {
      const pA = a.pricingSummary?.basePrice ?? 0;
      const pB = b.pricingSummary?.basePrice ?? 0;
      return pB - pA;
    });
  }

  return {
    items: records,
    totalPublishedCount,
    destinations: destinationFacets,
    priceRange: {
      min: overallMinPrice,
      max: overallMaxPrice,
    },
    pagination: {
      page,
      limit,
      total: totalFiltered,
      totalPages: Math.ceil(totalFiltered / limit),
    },
  };
};

const mapPackageRecord = (record: any, isAdmin = false) => ({
  id: record.id,
  serviceId: record.serviceId,
  name: record.name,
  description: record.description,
  durationMinutes: record.durationMinutes,
  boatSize: record.boatSize,
  minPax: record.minPax,
  maxCapacity: record.maxCapacity,
  sellingPrice: record.sellingPrice ? record.sellingPrice.toNumber() : 0,
  ...(isAdmin && record.netPrice != null ? { netPrice: record.netPrice.toNumber() } : {}),
  currency: record.currency,
  isActive: record.isActive,
  sortOrder: record.sortOrder,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const mapPickupZoneRecord = (record: any) => ({
  id: record.id,
  serviceId: record.serviceId,
  operatorName: record.operatorName,
  zoneName: record.zoneName,
  description: record.description,
  morningPickupTime: record.morningPickupTime,
  afternoonPickupTime: record.afternoonPickupTime,
  hasPrivateTransfer: Boolean(record.hasPrivateTransfer),
  privateTransferCharge: record.privateTransferCharge ? record.privateTransferCharge.toNumber() : null,
  morningPierArrival: record.morningPierArrival,
  afternoonPierArrival: record.afternoonPierArrival,
  surchargeAmount: record.surchargeAmount ? record.surchargeAmount.toNumber() : 0,
  surchargeUnit: record.surchargeUnit,
  currency: record.currency,
  isActive: record.isActive,
  sortOrder: record.sortOrder,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const findServiceById = async (id: string, includeUnpublished = false): Promise<ServiceDetail | null> => {
  const where: any = { id };
  if (!includeUnpublished) {
    where.status = "PUBLISHED";
    where.archivedAt = null;
  }

  const result = await db.service.findUnique({
    where,
    include: {
      availability: { orderBy: { date: "asc" } },
      pricing: { orderBy: { validFrom: "asc" } },
      packages: { orderBy: { sortOrder: "asc" } },
      timeSlots: { orderBy: { sortOrder: "asc" } },
      pickupZones: { orderBy: { sortOrder: "asc" } },
      pickupAssignments: { include: { pickupZone: true }, orderBy: { sortOrder: "asc" } },
      media: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!result) return null;

  // Filter inactive relations for public view
  const packages = includeUnpublished
    ? result.packages.map((p: any) => mapPackageRecord(p, true))
    : result.packages.filter((p: any) => p.isActive).map((p: any) => mapPackageRecord(p, false));

  const timeSlots = includeUnpublished
    ? result.timeSlots
    : result.timeSlots.filter((t: any) => t.isActive);

  const legacyPickupZones = includeUnpublished
    ? result.pickupZones.map(mapPickupZoneRecord)
    : result.pickupZones.filter((z: any) => z.isActive).map(mapPickupZoneRecord);

  // Resolve global pickup assignments with nullable overrides when present
  const assignedPickupZones = ((result as any).pickupAssignments || [])
    .filter((a: any) => includeUnpublished || (a.isActive && a.pickupZone?.isActive))
    .map((a: any) =>
      mapPickupZoneRecord({
        ...a.pickupZone,
        morningPickupTime: a.morningPickupTimeOverride ?? a.pickupZone.morningPickupTime,
        afternoonPickupTime: a.afternoonPickupTimeOverride ?? a.pickupZone.afternoonPickupTime,
        surchargeAmount: a.surchargeOverride ?? a.pickupZone.surchargeAmount,
        privateTransferCharge:
          a.privateTransferChargeOverride ?? a.pickupZone.privateTransferCharge,
        isActive: a.isActive,
        sortOrder: a.sortOrder,
      })
    );

  const pickupZones =
    assignedPickupZones.length > 0 ? assignedPickupZones : legacyPickupZones;

  // Map the nested pricing array to convert Decimal to number
  return {
    ...result,
    pricing: result.pricing.map(mapPricingRecord),
    packages,
    timeSlots,
    pickupZones,
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

const toSafeNumber = (val: unknown, fallback: number): number => {
  if (val === "" || val === null || val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

const toSafeNullableNumber = (val: unknown): number | null => {
  if (val === "" || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
};

const toSafeInt = (val: unknown, fallback: number): number => {
  return Math.round(toSafeNumber(val, fallback));
};

const toSafeNullableInt = (val: unknown): number | null => {
  const n = toSafeNullableNumber(val);
  return n !== null ? Math.round(n) : null;
};

export const createServiceRecord = async (data: CreateServiceInput): Promise<ServiceRecord> => {
  const { pricing, availability, packages, timeSlots, pickupZones } = data;

  const cleanServiceData = {
    name: data.name,
    description: data.description ?? null,
    type: data.type,
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.pricingType !== undefined ? { pricingType: data.pricingType } : {}),
    providerName: data.providerName || null,
    providerId: data.providerId || null,
    ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
  };

  return db.$transaction(async (tx) => {
    const created = await tx.service.create({
      data: cleanServiceData,
    });

    if (pricing) {
      await tx.servicePricing.create({
        data: {
          serviceId: created.id,
          currency: pricing.currency || "THB",
          basePrice: toSafeNumber(pricing.basePrice, 0),
          discountedPrice: toSafeNullableNumber(pricing.discountedPrice),
          taxRate: toSafeNumber(pricing.taxRate, 0),
          validFrom: pricing.validFrom ? new Date(pricing.validFrom) : null,
          validTo: pricing.validTo ? new Date(pricing.validTo) : null,
        },
      });
    }

    if (availability && availability.length > 0) {
      for (const av of availability) {
        const parsedDate = new Date(av.date);
        if (Number.isNaN(parsedDate.getTime())) continue;
        await tx.serviceAvailability.upsert({
          where: {
            serviceId_date: {
              serviceId: created.id,
              date: parsedDate,
            },
          },
          update: {
            isAvailable: av.isAvailable !== false,
            capacity: toSafeNullableInt(av.capacity),
            externalReferenceId: av.externalReferenceId ?? null,
          },
          create: {
            serviceId: created.id,
            date: parsedDate,
            isAvailable: av.isAvailable !== false,
            capacity: toSafeNullableInt(av.capacity),
            externalReferenceId: av.externalReferenceId ?? null,
          },
        });
      }
    }

    if (packages && packages.length > 0) {
      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        await tx.servicePackage.create({
          data: {
            serviceId: created.id,
            name: pkg.name,
            description: pkg.description ?? null,
            durationMinutes: Math.max(1, toSafeInt(pkg.durationMinutes, 60)),
            boatSize: pkg.boatSize ?? null,
            minPax: Math.max(1, toSafeInt(pkg.minPax, 1)),
            maxCapacity: Math.max(1, toSafeInt(pkg.maxCapacity, 2)),
            sellingPrice: toSafeNumber(pkg.sellingPrice, 0),
            netPrice: toSafeNullableNumber(pkg.netPrice),
            currency: pkg.currency || "THB",
            isActive: pkg.isActive ?? true,
            sortOrder: toSafeInt(pkg.sortOrder, i),
          },
        });
      }
    }

    if (timeSlots && timeSlots.length > 0) {
      for (let i = 0; i < timeSlots.length; i++) {
        const slot = timeSlots[i];
        await tx.serviceTimeSlot.create({
          data: {
            serviceId: created.id,
            name: slot.name,
            departureTime: slot.departureTime,
            capacity: toSafeNullableInt(slot.capacity),
            isActive: slot.isActive ?? true,
            sortOrder: toSafeInt(slot.sortOrder, i),
          },
        });
      }
    }

    if (pickupZones && pickupZones.length > 0) {
      for (let i = 0; i < pickupZones.length; i++) {
        const zone = pickupZones[i];
        await tx.pickupZone.create({
          data: {
            serviceId: created.id,
            operatorName: zone.operatorName ?? created.providerName ?? null,
            zoneName: zone.zoneName,
            description: zone.description ?? null,
            morningPickupTime: zone.morningPickupTime ?? null,
            afternoonPickupTime: zone.afternoonPickupTime ?? null,
            hasPrivateTransfer: Boolean(zone.hasPrivateTransfer),
            privateTransferCharge: toSafeNullableNumber(zone.privateTransferCharge),
            morningPierArrival: zone.morningPierArrival ?? "08:30 AM",
            afternoonPierArrival: zone.afternoonPierArrival ?? "12:30 PM",
            surchargeAmount: toSafeNumber(zone.surchargeAmount, 0),
            surchargeUnit: zone.surchargeUnit || "PER_BOOKING",
            currency: zone.currency || "THB",
            isActive: zone.isActive ?? true,
            sortOrder: toSafeInt(zone.sortOrder, i),
          },
        });
      }
    }

    return created;
  }) as Promise<ServiceRecord>;
};

export const updateServiceRecord = async (
  id: string,
  data: UpdateServiceInput & { expectedVersion?: number; updatedById?: string }
): Promise<ServiceRecord> => {
  const { pricing, availability, packages, timeSlots, pickupZones, expectedVersion, updatedById, ...serviceData } = data;

  return db.$transaction(async (tx) => {
    const existingService = await tx.service.findUnique({
      where: { id },
      select: { id: true, version: true, metadata: true, providerName: true },
    });

    if (!existingService) {
      throw new AppError("Service not found", 404);
    }

    if (expectedVersion !== undefined && existingService.version !== expectedVersion) {
      throw new AppError(
        `Version conflict: expected version ${expectedVersion}, but current version is ${existingService.version}`,
        409
      );
    }

    let mergedServiceData: Record<string, any> = {
      ...serviceData,
      version: { increment: 1 },
      ...(updatedById ? { updatedById } : {}),
    };
    if (
      serviceData.metadata !== undefined &&
      serviceData.metadata !== null &&
      typeof serviceData.metadata === "object" &&
      !Array.isArray(serviceData.metadata)
    ) {
      const existingMeta =
        existingService.metadata &&
        typeof existingService.metadata === "object" &&
        !Array.isArray(existingService.metadata)
          ? (existingService.metadata as Record<string, unknown>)
          : {};
      mergedServiceData = {
        ...mergedServiceData,
        metadata: {
          ...existingMeta,
          ...(serviceData.metadata as Record<string, unknown>),
        } as any,
      };
    }

    const updated = await tx.service.update({
      where: { id },
      data: mergedServiceData,
    });

    if (pricing) {
      const existingPricing = await tx.servicePricing.findFirst({ where: { serviceId: id } });
      if (existingPricing) {
        await tx.servicePricing.update({
          where: { id: existingPricing.id },
          data: {
            currency: pricing.currency,
            basePrice: pricing.basePrice,
            discountedPrice: pricing.discountedPrice,
            taxRate: pricing.taxRate,
            validFrom: pricing.validFrom ? new Date(pricing.validFrom) : undefined,
            validTo: pricing.validTo ? new Date(pricing.validTo) : undefined,
          },
        });
      } else {
        await tx.servicePricing.create({
          data: {
            serviceId: id,
            currency: pricing.currency || "THB",
            basePrice: pricing.basePrice ?? 0,
            discountedPrice: pricing.discountedPrice ?? null,
            taxRate: pricing.taxRate ?? 0,
            validFrom: pricing.validFrom ? new Date(pricing.validFrom) : null,
            validTo: pricing.validTo ? new Date(pricing.validTo) : null,
          },
        });
      }
    }

    if (availability && availability.length > 0) {
      for (const av of availability) {
        await tx.serviceAvailability.upsert({
          where: {
            serviceId_date: {
              serviceId: id,
              date: new Date(av.date),
            },
          },
          update: {
            isAvailable: av.isAvailable,
            capacity: av.capacity,
            externalReferenceId: av.externalReferenceId,
            lastVerifiedAt: new Date(),
          },
          create: {
            serviceId: id,
            date: new Date(av.date),
            isAvailable: av.isAvailable,
            capacity: av.capacity,
            externalReferenceId: av.externalReferenceId,
            lastVerifiedAt: new Date(),
          },
        });
      }
    }

    if (packages !== undefined) {
      const existingPackages = await tx.servicePackage.findMany({
        where: { serviceId: id },
        select: { id: true },
      });
      const existingPkgIds = new Set(existingPackages.map((p) => p.id));
      const retainedPkgIds = new Set<string>();

      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i] as any;
        const pkgData = {
          name: pkg.name,
          description: pkg.description ?? null,
          durationMinutes: Math.max(1, toSafeInt(pkg.durationMinutes, 60)),
          boatSize: pkg.boatSize ?? null,
          minPax: Math.max(1, toSafeInt(pkg.minPax, 1)),
          maxCapacity: Math.max(1, toSafeInt(pkg.maxCapacity, 2)),
          sellingPrice: toSafeNumber(pkg.sellingPrice, 0),
          netPrice: toSafeNullableNumber(pkg.netPrice),
          currency: pkg.currency || "THB",
          isActive: pkg.isActive ?? true,
          sortOrder: toSafeInt(pkg.sortOrder, i),
        };

        if (pkg.id) {
          if (!existingPkgIds.has(pkg.id)) {
            throw new AppError(`Package ${pkg.id} does not belong to this service`, 400);
          }
          retainedPkgIds.add(pkg.id);
          await tx.servicePackage.update({
            where: { id: pkg.id },
            data: pkgData,
          });
        } else {
          await tx.servicePackage.create({
            data: { serviceId: id, ...pkgData },
          });
        }
      }

      for (const oldId of existingPkgIds) {
        if (!retainedPkgIds.has(oldId)) {
          const bookingCount = await tx.booking.count({ where: { packageId: oldId } });
          if (bookingCount > 0) {
            await tx.servicePackage.update({
              where: { id: oldId },
              data: { isActive: false },
            });
          } else {
            await tx.servicePackage.delete({ where: { id: oldId } });
          }
        }
      }
    }

    if (timeSlots !== undefined) {
      const existingSlots = await tx.serviceTimeSlot.findMany({
        where: { serviceId: id },
        select: { id: true },
      });
      const existingSlotIds = new Set(existingSlots.map((s) => s.id));
      const retainedSlotIds = new Set<string>();

      for (let i = 0; i < timeSlots.length; i++) {
        const slot = timeSlots[i] as any;
        const slotData = {
          name: slot.name,
          departureTime: slot.departureTime,
          capacity: toSafeNullableInt(slot.capacity),
          isActive: slot.isActive ?? true,
          sortOrder: toSafeInt(slot.sortOrder, i),
        };

        if (slot.id) {
          if (!existingSlotIds.has(slot.id)) {
            throw new AppError(`TimeSlot ${slot.id} does not belong to this service`, 400);
          }
          retainedSlotIds.add(slot.id);
          await tx.serviceTimeSlot.update({
            where: { id: slot.id },
            data: slotData,
          });
        } else {
          await tx.serviceTimeSlot.create({
            data: { serviceId: id, ...slotData },
          });
        }
      }

      for (const oldId of existingSlotIds) {
        if (!retainedSlotIds.has(oldId)) {
          const bookingCount = await tx.booking.count({ where: { timeSlotId: oldId } });
          if (bookingCount > 0) {
            await tx.serviceTimeSlot.update({
              where: { id: oldId },
              data: { isActive: false },
            });
          } else {
            await tx.serviceTimeSlot.delete({ where: { id: oldId } });
          }
        }
      }
    }

    if (pickupZones !== undefined) {
      const existingZones = await tx.pickupZone.findMany({
        where: { serviceId: id },
        select: { id: true },
      });
      const existingZoneIds = new Set(existingZones.map((z) => z.id));
      const retainedZoneIds = new Set<string>();

      for (let i = 0; i < pickupZones.length; i++) {
        const zone = pickupZones[i] as any;
        const zoneData = {
          operatorName: zone.operatorName ?? updated.providerName ?? null,
          zoneName: zone.zoneName,
          description: zone.description ?? null,
          morningPickupTime: zone.morningPickupTime ?? null,
          afternoonPickupTime: zone.afternoonPickupTime ?? null,
          hasPrivateTransfer: Boolean(zone.hasPrivateTransfer),
          privateTransferCharge: toSafeNullableNumber(zone.privateTransferCharge),
          morningPierArrival: zone.morningPierArrival ?? "08:30 AM",
          afternoonPierArrival: zone.afternoonPierArrival ?? "12:30 PM",
          surchargeAmount: toSafeNumber(zone.surchargeAmount, 0),
          surchargeUnit: zone.surchargeUnit || "PER_BOOKING",
          currency: zone.currency || "THB",
          isActive: zone.isActive ?? true,
          sortOrder: toSafeInt(zone.sortOrder, i),
        };

        if (zone.id) {
          if (!existingZoneIds.has(zone.id)) {
            throw new AppError(`PickupZone ${zone.id} does not belong to this service`, 400);
          }
          retainedZoneIds.add(zone.id);
          await tx.pickupZone.update({
            where: { id: zone.id },
            data: zoneData,
          });
        } else {
          await tx.pickupZone.create({
            data: { serviceId: id, ...zoneData },
          });
        }
      }

      for (const oldId of existingZoneIds) {
        if (!retainedZoneIds.has(oldId)) {
          const bookingCount = await tx.booking.count({ where: { pickupZoneId: oldId } });
          if (bookingCount > 0) {
            await tx.pickupZone.update({
              where: { id: oldId },
              data: { isActive: false },
            });
          } else {
            await tx.pickupZone.delete({ where: { id: oldId } });
          }
        }
      }
    }

    return updated;
  }) as Promise<ServiceRecord>;
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

export const countServiceBookings = async (serviceId: string): Promise<number> => {
  return db.booking.count({
    where: { serviceId },
  });
};

export const deleteServiceRecord = async (serviceId: string): Promise<{ id: string; name: string }> => {
  return db.$transaction(async (tx) => {
    // 1. Double check booking dependencies inside transaction
    const bookingCount = await tx.booking.count({
      where: { serviceId },
    });
    if (bookingCount > 0) {
      throw new AppError(
        `Cannot delete tour because it has ${bookingCount} existing ${
          bookingCount === 1 ? "booking" : "bookings"
        }. Please move the tour to Draft or Unpublished status instead.`,
        400
      );
    }

    // 2. Unlink or clean up any direct media references to this service
    await tx.media.updateMany({
      where: { serviceId },
      data: { serviceId: null },
    });

    // 3. Delete any pricing rules targeted directly at this service
    await tx.pricingRule.deleteMany({
      where: { serviceId },
    });

    // 4. Delete the service (availability and pricing cascade automatically)
    const deleted = await tx.service.delete({
      where: { id: serviceId },
      select: { id: true, name: true },
    });

    return deleted;
  });
};

// ========================================================
// SERVICE PACKAGES
// ========================================================

export const findPackagesByServiceId = async (serviceId: string, isAdmin = false) => {
  const where: any = { serviceId };
  if (!isAdmin) {
    where.isActive = true;
  }
  const records = await db.servicePackage.findMany({
    where,
    orderBy: { sortOrder: "asc" },
  });
  return records.map((r: any) => mapPackageRecord(r, isAdmin));
};

export const createPackageRecord = async (serviceId: string, data: any) => {
  const created = await db.servicePackage.create({
    data: {
      serviceId,
      name: data.name,
      description: data.description || null,
      durationMinutes: data.durationMinutes,
      boatSize: data.boatSize || null,
      minPax: data.minPax ?? 1,
      maxCapacity: data.maxCapacity,
      sellingPrice: data.sellingPrice,
      netPrice: data.netPrice != null ? data.netPrice : null,
      currency: data.currency || "THB",
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    },
  });
  return mapPackageRecord(created, true);
};

export const updatePackageRecord = async (packageId: string, data: any) => {
  const updated = await db.servicePackage.update({
    where: { id: packageId },
    data,
  });
  return mapPackageRecord(updated, true);
};

export const deletePackageRecord = async (packageId: string) => {
  return db.servicePackage.delete({
    where: { id: packageId },
  });
};

// ========================================================
// SERVICE TIME SLOTS
// ========================================================

export const findTimeSlotsByServiceId = async (serviceId: string, isAdmin = false) => {
  const where: any = { serviceId };
  if (!isAdmin) {
    where.isActive = true;
  }
  return db.serviceTimeSlot.findMany({
    where,
    orderBy: { sortOrder: "asc" },
  });
};

export const createTimeSlotRecord = async (serviceId: string, data: any) => {
  return db.serviceTimeSlot.create({
    data: {
      serviceId,
      name: data.name,
      departureTime: data.departureTime,
      capacity: data.capacity != null ? data.capacity : null,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    },
  });
};

export const updateTimeSlotRecord = async (slotId: string, data: any) => {
  return db.serviceTimeSlot.update({
    where: { id: slotId },
    data,
  });
};

export const deleteTimeSlotRecord = async (slotId: string) => {
  return db.serviceTimeSlot.delete({
    where: { id: slotId },
  });
};

// ========================================================
// PICKUP ZONES
// ========================================================

export const findPickupZones = async (serviceId?: string, isAdmin = false) => {
  const where: any = {};
  if (serviceId) {
    where.OR = [{ serviceId }, { serviceId: null }];
  }
  if (!isAdmin) {
    where.isActive = true;
  }
  const records = await db.pickupZone.findMany({
    where,
    orderBy: { sortOrder: "asc" },
  });
  return records.map(mapPickupZoneRecord);
};

export const createPickupZoneRecord = async (data: any) => {
  const created = await db.pickupZone.create({
    data: {
      serviceId: data.serviceId || null,
      operatorName: data.operatorName || null,
      zoneName: data.zoneName,
      description: data.description || null,
      morningPickupTime: data.morningPickupTime || null,
      afternoonPickupTime: data.afternoonPickupTime || null,
      hasPrivateTransfer: data.hasPrivateTransfer ?? false,
      privateTransferCharge: data.privateTransferCharge != null ? data.privateTransferCharge : null,
      morningPierArrival: data.morningPierArrival || "08:30 AM",
      afternoonPierArrival: data.afternoonPierArrival || "12:30 PM",
      surchargeAmount: data.surchargeAmount ?? 0,
      surchargeUnit: data.surchargeUnit || "PER_BOOKING",
      currency: data.currency || "THB",
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    },
  });
  return mapPickupZoneRecord(created);
};

export const updatePickupZoneRecord = async (zoneId: string, data: any) => {
  const updated = await db.pickupZone.update({
    where: { id: zoneId },
    data,
  });
  return mapPickupZoneRecord(updated);
};

export const deletePickupZoneRecord = async (zoneId: string) => {
  return db.pickupZone.delete({
    where: { id: zoneId },
  });
};