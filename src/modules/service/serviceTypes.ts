import type { Prisma } from "../../../generated/prisma/client.js";
import type { PaginationMeta, PaginatedResult } from "../../types/common.js";

export type ServiceType = "HOTEL" | "PACKAGE" | "TOUR";
export type ServiceStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";

export interface ServicePricingSummary {
  currency: string;
  basePrice: number;
  discountedPrice: number | null;
  taxRate: number;
  validFrom: Date | null;
  validTo: Date | null;
}

export interface ServiceAvailabilitySummary {
  availableDateCount: number;
  unavailableDateCount: number;
  totalCapacity: number | null;
  bookedCount: number;
}

export interface ServiceRecord {
  id: string;
  name: string;
  description: string | null;
  type: ServiceType;
  status: ServiceStatus;
  providerName: string | null;
  providerId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  pricingSummary?: ServicePricingSummary | null;
  availabilitySummary?: ServiceAvailabilitySummary | null;
  relevanceScore?: number;
}

export interface ServiceAvailabilityRecord {
  id: string;
  serviceId: string;
  date: Date;
  isAvailable: boolean;
  capacity: number | null;
  bookedCount: number;
  externalReferenceId: string | null;
  lastVerifiedAt: Date | null;
}

export interface ServicePricingRecord {
  id: string;
  serviceId: string;
  currency: string;
  basePrice: number;
  discountedPrice: number | null;
  taxRate: number;
  validFrom: Date | null;
  validTo: Date | null;
}

export interface ServiceDetail extends ServiceRecord {
  availability: ServiceAvailabilityRecord[];
  pricing: ServicePricingRecord[];
  media?: any[];
}

export interface CreateServiceInput {
  name: string;
  description?: string;
  type: ServiceType;
  providerName?: string;
  providerId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  type?: ServiceType;
  providerName?: string;
  providerId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface UpdateServiceStatusInput {
  status: ServiceStatus;
}

export interface AvailabilityUpdateInput {
  date: string; // ISO date string
  isAvailable: boolean;
  capacity?: number;
  externalReferenceId?: string;
}

export interface PricingUpdateInput {
  currency?: string;
  basePrice?: number;
  discountedPrice?: number;
  taxRate?: number;
  validFrom?: string;
  validTo?: string;
}

export type ServiceSortField = "name" | "createdAt" | "updatedAt" | "status" | "relevance";
export type SortOrder = "asc" | "desc";

export interface GetServicesQuery {
  page?: number;
  limit?: number;
  type?: ServiceType;
  status?: ServiceStatus;
  search?: string;
  q?: string;
  sortBy?: ServiceSortField;
  sortOrder?: SortOrder;
}

export interface BulkUpdateServiceStatusInput {
  serviceIds: string[];
  status: ServiceStatus;
}

export interface BulkUpdateServiceStatusResult {
  updatedCount: number;
  requestedCount: number;
  updatedIds: string[];
  notFoundIds: string[];
  status: ServiceStatus;
}