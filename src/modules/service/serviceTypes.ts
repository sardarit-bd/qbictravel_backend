import type { Prisma } from "../../../generated/prisma/client.js";
import type { PaginationMeta, PaginatedResult } from "../../types/common.js";

export type ServiceType = "HOTEL" | "PACKAGE" | "TOUR";
export type ServiceStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
export type PricingModelType = "PER_PERSON" | "PER_PACKAGE";
export type SurchargeUnit = "PER_BOOKING" | "PER_VEHICLE" | "PER_PERSON";

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
  pricingType?: PricingModelType;
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

export interface ServicePackageRecord {
  id: string;
  serviceId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  boatSize: string | null;
  minPax: number;
  maxCapacity: number;
  sellingPrice: number;
  netPrice?: number | null; // Omitted or masked in customer responses
  currency: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceTimeSlotRecord {
  id: string;
  serviceId: string;
  name: string;
  departureTime: string;
  capacity: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PickupZoneRecord {
  id: string;
  serviceId: string | null;
  operatorName: string | null;
  zoneName: string;
  description: string | null;
  morningPickupTime?: string | null;
  afternoonPickupTime?: string | null;
  hasPrivateTransfer: boolean;
  privateTransferCharge?: number | null;
  morningPierArrival?: string | null;
  afternoonPierArrival?: string | null;
  surchargeAmount: number;
  surchargeUnit: SurchargeUnit;
  currency: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceDetail extends ServiceRecord {
  availability: ServiceAvailabilityRecord[];
  pricing: ServicePricingRecord[];
  packages?: ServicePackageRecord[];
  timeSlots?: ServiceTimeSlotRecord[];
  pickupZones?: PickupZoneRecord[];
  media?: any[];
}

export interface CreateServiceInput {
  name: string;
  description?: string;
  type: ServiceType;
  status?: ServiceStatus;
  pricingType?: PricingModelType;
  providerName?: string;
  providerId?: string;
  metadata?: Prisma.InputJsonValue;
  pricing?: PricingUpdateInput;
  availability?: AvailabilityUpdateInput[];
  packages?: Array<{
    id?: string;
    name: string;
    description?: string;
    durationMinutes: number;
    boatSize?: string;
    minPax?: number;
    maxCapacity: number;
    sellingPrice: number;
    netPrice?: number;
    currency?: string;
    isActive?: boolean;
    sortOrder?: number;
  }>;
  timeSlots?: Array<{
    id?: string;
    name: string;
    departureTime: string;
    capacity?: number;
    isActive?: boolean;
    sortOrder?: number;
  }>;
  pickupZones?: Array<{
    id?: string;
    operatorName?: string;
    zoneName: string;
    description?: string;
    morningPickupTime?: string;
    afternoonPickupTime?: string;
    hasPrivateTransfer?: boolean;
    privateTransferCharge?: number;
    morningPierArrival?: string;
    afternoonPierArrival?: string;
    surchargeAmount?: number;
    surchargeUnit?: SurchargeUnit;
    currency?: string;
    isActive?: boolean;
    sortOrder?: number;
  }>;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  type?: ServiceType;
  status?: ServiceStatus;
  pricingType?: PricingModelType;
  providerName?: string;
  providerId?: string;
  metadata?: Prisma.InputJsonValue;
  pricing?: PricingUpdateInput;
  availability?: AvailabilityUpdateInput[];
  packages?: Array<{
    id?: string;
    name: string;
    description?: string;
    durationMinutes: number;
    boatSize?: string;
    minPax?: number;
    maxCapacity: number;
    sellingPrice: number;
    netPrice?: number;
    currency?: string;
    isActive?: boolean;
    sortOrder?: number;
  }>;
  timeSlots?: Array<{
    id?: string;
    name: string;
    departureTime: string;
    capacity?: number;
    isActive?: boolean;
    sortOrder?: number;
  }>;
  pickupZones?: Array<{
    id?: string;
    operatorName?: string;
    zoneName: string;
    description?: string;
    morningPickupTime?: string;
    afternoonPickupTime?: string;
    hasPrivateTransfer?: boolean;
    privateTransferCharge?: number;
    morningPierArrival?: string;
    afternoonPierArrival?: string;
    surchargeAmount?: number;
    surchargeUnit?: SurchargeUnit;
    currency?: string;
    isActive?: boolean;
    sortOrder?: number;
  }>;
}

export interface CreateServicePackageInput {
  name: string;
  description?: string;
  durationMinutes: number;
  boatSize?: string;
  minPax?: number;
  maxCapacity: number;
  sellingPrice: number;
  netPrice?: number;
  currency?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateServicePackageInput {
  name?: string;
  description?: string;
  durationMinutes?: number;
  boatSize?: string;
  minPax?: number;
  maxCapacity?: number;
  sellingPrice?: number;
  netPrice?: number;
  currency?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreateServiceTimeSlotInput {
  name: string;
  departureTime: string;
  capacity?: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateServiceTimeSlotInput {
  name?: string;
  departureTime?: string;
  capacity?: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface CreatePickupZoneInput {
  serviceId?: string;
  operatorName?: string;
  zoneName: string;
  description?: string;
  morningPickupTime?: string;
  afternoonPickupTime?: string;
  hasPrivateTransfer?: boolean;
  privateTransferCharge?: number;
  morningPierArrival?: string;
  afternoonPierArrival?: string;
  surchargeAmount?: number;
  surchargeUnit?: SurchargeUnit;
  currency?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdatePickupZoneInput {
  serviceId?: string;
  operatorName?: string;
  zoneName?: string;
  description?: string;
  morningPickupTime?: string;
  afternoonPickupTime?: string;
  hasPrivateTransfer?: boolean;
  privateTransferCharge?: number;
  morningPierArrival?: string;
  afternoonPierArrival?: string;
  surchargeAmount?: number;
  surchargeUnit?: SurchargeUnit;
  currency?: string;
  isActive?: boolean;
  sortOrder?: number;
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
  discountedPrice?: number | null;
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