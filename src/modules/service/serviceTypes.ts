import type { Prisma } from "../../../generated/prisma/client.js";
import type { PaginationMeta, PaginatedResult } from "../../types/common.js";

export type ServiceType = "HOTEL" | "PACKAGE" | "TOUR";
export type ServiceStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";

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

export interface GetServicesQuery {
  page?: number;
  limit?: number;
  type?: ServiceType;
}