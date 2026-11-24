import * as yup from "yup";
import type { ServiceType, ServiceStatus } from "./serviceTypes.js";

/**
 * @openapi
 * components:
 *   schemas:
 *     ServiceType:
 *       type: string
 *       enum: [HOTEL, PACKAGE, TOUR]
 *     ServiceStatus:
 *       type: string
 *       enum: [DRAFT, PUBLISHED, UNPUBLISHED]
 *     CreateServiceRequest:
 *       type: object
 *       required:
 *         - name
 *         - type
 *       properties:
 *         name:
 *           type: string
 *           example: "Grand Hotel"
 *         description:
 *           type: string
 *           example: "A luxurious stay in the city center"
 *         type:
 *           $ref: '#/components/schemas/ServiceType'
 *         providerName:
 *           type: string
 *           example: "BookingExternal"
 *         providerId:
 *           type: string
 *           example: "EXT-12345"
 *         metadata:
 *           type: object
 *           description: "Service-specific fields (e.g., starRating for hotels)"
 *     UpdateServiceStatusRequest:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           $ref: '#/components/schemas/ServiceStatus'
 *     AvailabilityUpdateRequest:
 *       type: object
 *       required:
 *         - date
 *         - isAvailable
 *       properties:
 *         date:
 *           type: string
 *           format: date
 *           example: "2024-12-25"
 *         isAvailable:
 *           type: boolean
 *           example: true
 *         capacity:
 *           type: integer
 *           example: 50
 *         externalReferenceId:
 *           type: string
 *           example: "EXT-AV-999"
 *     PricingUpdateRequest:
 *       type: object
 *       properties:
 *         currency:
 *           type: string
 *           example: "USD"
 *         basePrice:
 *           type: number
 *           format: float
 *           example: 150.00
 *         discountedPrice:
 *           type: number
 *           format: float
 *           example: 120.00
 *         taxRate:
 *           type: number
 *           format: float
 *           example: 10.00
 *         validFrom:
 *           type: string
 *           format: date-time
 *         validTo:
 *           type: string
 *           format: date-time
 */

const serviceTypeSchema = yup.string().oneOf(["HOTEL", "PACKAGE", "TOUR"] as ServiceType[]).required("Type is required");
const serviceStatusSchema = yup.string().oneOf(["DRAFT", "PUBLISHED", "UNPUBLISHED"] as ServiceStatus[]).required("Status is required");
const pricingModelTypeSchema = yup.string().oneOf(["PER_PERSON", "PER_PACKAGE"]).optional();
const surchargeUnitSchema = yup.string().oneOf(["PER_BOOKING", "PER_VEHICLE", "PER_PERSON"]).optional();

export const createServiceSchema = yup.object({
  name: yup.string().trim().min(3, "Name must be at least 3 characters").required("Name is required"),
  description: yup.string().trim().optional(),
  type: serviceTypeSchema,
  pricingType: pricingModelTypeSchema,
  providerName: yup.string().trim().optional(),
  providerId: yup.string().trim().optional(),
  metadata: yup.mixed().optional(),
});

export const updateServiceSchema = yup.object({
  name: yup.string().trim().min(3, "Name must be at least 3 characters").optional(),
  description: yup.string().trim().optional(),
  type: serviceTypeSchema.optional(),
  pricingType: pricingModelTypeSchema,
  providerName: yup.string().trim().optional(),
  providerId: yup.string().trim().optional(),
  metadata: yup.mixed().optional(),
});

export const packageIdParamSchema = yup.object({
  serviceId: yup.string().trim().uuid("Invalid service ID format").required("Service ID is required"),
  packageId: yup.string().trim().uuid("Invalid package ID format").required("Package ID is required"),
});

export const timeSlotIdParamSchema = yup.object({
  serviceId: yup.string().trim().uuid("Invalid service ID format").required("Service ID is required"),
  slotId: yup.string().trim().uuid("Invalid slot ID format").required("Slot ID is required"),
});

export const pickupZoneIdParamSchema = yup.object({
  serviceId: yup.string().trim().uuid("Invalid service ID format").optional(),
  zoneId: yup.string().trim().uuid("Invalid zone ID format").required("Zone ID is required"),
});

export const createServicePackageSchema = yup.object({
  name: yup.string().trim().min(2, "Package name must be at least 2 characters").required("Package name is required"),
  description: yup.string().trim().optional(),
  durationMinutes: yup.number().integer().min(1, "Duration must be at least 1 minute").required("Duration in minutes is required"),
  boatSize: yup.string().trim().optional(),
  minPax: yup.number().integer().min(1, "Minimum passenger count must be at least 1").default(1),
  maxCapacity: yup.number().integer().min(1, "Maximum passenger capacity must be at least 1").required("Maximum capacity is required"),
  sellingPrice: yup.number().min(0, "Selling price cannot be negative").required("Selling price is required"),
  netPrice: yup.number().min(0, "Net price cannot be negative").optional(),
  currency: yup.string().trim().uppercase().length(3, "Currency must be a 3-letter code").default("THB"),
  isActive: yup.boolean().default(true),
  sortOrder: yup.number().integer().default(0),
});

export const updateServicePackageSchema = yup.object({
  name: yup.string().trim().min(2).optional(),
  description: yup.string().trim().optional(),
  durationMinutes: yup.number().integer().min(1).optional(),
  boatSize: yup.string().trim().optional(),
  minPax: yup.number().integer().min(1).optional(),
  maxCapacity: yup.number().integer().min(1).optional(),
  sellingPrice: yup.number().min(0).optional(),
  netPrice: yup.number().min(0).optional(),
  currency: yup.string().trim().uppercase().length(3).optional(),
  isActive: yup.boolean().optional(),
  sortOrder: yup.number().integer().optional(),
});

export const createServiceTimeSlotSchema = yup.object({
  name: yup.string().trim().min(2, "Session name must be at least 2 characters").required("Session name is required"),
  departureTime: yup.string().trim().required("Departure time is required"),
  capacity: yup.number().integer().min(1).optional(),
  isActive: yup.boolean().default(true),
  sortOrder: yup.number().integer().default(0),
});

export const updateServiceTimeSlotSchema = yup.object({
  name: yup.string().trim().min(2).optional(),
  departureTime: yup.string().trim().optional(),
  capacity: yup.number().integer().min(1).optional(),
  isActive: yup.boolean().optional(),
  sortOrder: yup.number().integer().optional(),
});

export const createPickupZoneSchema = yup.object({
  zoneName: yup.string().trim().min(2, "Zone name must be at least 2 characters").required("Zone name is required"),
  description: yup.string().trim().optional(),
  surchargeAmount: yup.number().min(0, "Surcharge amount cannot be negative").default(0),
  surchargeUnit: surchargeUnitSchema.default("PER_BOOKING"),
  currency: yup.string().trim().uppercase().length(3).default("THB"),
  operatorName: yup.string().trim().optional(),
  isActive: yup.boolean().default(true),
  sortOrder: yup.number().integer().default(0),
});

export const updatePickupZoneSchema = yup.object({
  zoneName: yup.string().trim().min(2).optional(),
  description: yup.string().trim().optional(),
  surchargeAmount: yup.number().min(0).optional(),
  surchargeUnit: surchargeUnitSchema,
  currency: yup.string().trim().uppercase().length(3).optional(),
  operatorName: yup.string().trim().optional(),
  isActive: yup.boolean().optional(),
  sortOrder: yup.number().integer().optional(),
});

export const updateServiceStatusSchema = yup.object({
  status: serviceStatusSchema,
});

export const availabilityUpdateSchema = yup.object({
  date: yup.string().matches(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").required("Date is required"),
  isAvailable: yup.boolean().required("Availability status is required"),
  capacity: yup.number().integer().min(0).optional(),
  externalReferenceId: yup.string().trim().optional(),
});

export const pricingUpdateSchema = yup.object({
  currency: yup.string().trim().uppercase().length(3, "Currency must be a 3-letter code").optional(),
  basePrice: yup.number().min(0, "Base price cannot be negative").optional(),
  discountedPrice: yup
    .number()
    .transform((val, orig) => (orig === null || orig === "" ? null : val))
    .nullable()
    .optional()
    .test("is-valid-discount", "Discount price must be greater than 0", function (val) {
      if (val === null || val === undefined) return true;
      if (val <= 0) return this.createError({ message: "Discount price must be greater than 0" });
      const { basePrice } = this.parent;
      if (basePrice !== undefined && basePrice !== null && val >= basePrice) {
        return this.createError({ message: "Discount price must be lower than the adult price" });
      }
      return true;
    }),
  taxRate: yup.number().min(0, "Tax rate cannot be negative").optional(),
  validFrom: yup.string().optional(),
  validTo: yup.string().optional(),
});

export const getAdminServicesQuerySchema = yup.object({
  page: yup
    .number()
    .transform((val, orig) => (orig === "" || orig === undefined ? undefined : Number(orig)))
    .integer("Page must be an integer")
    .min(1, "Page must be at least 1")
    .optional(),
  limit: yup
    .number()
    .transform((val, orig) => (orig === "" || orig === undefined ? undefined : Number(orig)))
    .integer("Limit must be an integer")
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .optional(),
  type: yup.string().oneOf(["HOTEL", "PACKAGE", "TOUR"] as ServiceType[], "Invalid service type").optional(),
  status: yup.string().oneOf(["DRAFT", "PUBLISHED", "UNPUBLISHED"] as ServiceStatus[], "Invalid service status").optional(),
  search: yup.string().trim().optional(),
  q: yup.string().trim().optional(),
  sortBy: yup.string().oneOf(["name", "createdAt", "updatedAt", "status", "relevance"], "Invalid sort field").optional(),
  sortOrder: yup.string().oneOf(["asc", "desc"], "Sort order must be 'asc' or 'desc'").optional(),
});

export const bulkUpdateServiceStatusSchema = yup.object({
  serviceIds: yup
    .array()
    .of(yup.string().trim().uuid("Invalid service ID format").required("Service ID is required"))
    .min(1, "At least one service ID must be provided")
    .required("serviceIds array is required"),
  status: serviceStatusSchema,
});

export const serviceIdParamSchema = yup.object({
  serviceId: yup.string().trim().uuid("Invalid service ID format").required("Service ID is required"),
});