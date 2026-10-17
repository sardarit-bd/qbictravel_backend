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

export const createServiceSchema = yup.object({
  name: yup.string().trim().min(3, "Name must be at least 3 characters").required("Name is required"),
  description: yup.string().trim().optional(),
  type: serviceTypeSchema,
  providerName: yup.string().trim().optional(),
  providerId: yup.string().trim().optional(),
  metadata: yup.mixed().optional(),
});

export const updateServiceSchema = yup.object({
  name: yup.string().trim().min(3, "Name must be at least 3 characters").optional(),
  description: yup.string().trim().optional(),
  type: serviceTypeSchema.optional(),
  providerName: yup.string().trim().optional(),
  providerId: yup.string().trim().optional(),
  metadata: yup.mixed().optional(),
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
  discountedPrice: yup.number().min(0, "Discounted price cannot be negative").optional(),
  taxRate: yup.number().min(0, "Tax rate cannot be negative").optional(),
  validFrom: yup.string().optional(),
  validTo: yup.string().optional(),
});