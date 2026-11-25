import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as serviceService from "./serviceService.js";
import type {
  CreateServiceInput,
  UpdateServiceInput,
  UpdateServiceStatusInput,
  AvailabilityUpdateInput,
  PricingUpdateInput,
  GetServicesQuery,
  BulkUpdateServiceStatusInput,
} from "./serviceTypes.js";

export const getServices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawDestinations = req.query.destinations || req.query.destination;
    const destinations = typeof rawDestinations === "string" && rawDestinations.includes(",")
      ? rawDestinations.split(",").map((s) => s.trim())
      : rawDestinations;

    const query: GetServicesQuery = {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      type: req.query.type as any,
      search: (req.query.search || req.query.q) as string | undefined,
      destinations: destinations as any,
      minPrice: req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined,
      sortBy: req.query.sortBy as any,
      sortOrder: req.query.sortOrder as any,
    };
    const result = await serviceService.getPublishedServices(query);
    sendResponse(res, 200, true, "Services retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const service = await serviceService.getServiceDetails(serviceId, false);
    sendResponse(res, 200, true, "Service details retrieved successfully", service);
  } catch (error) {
    next(error);
  }
};

export const getServiceAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const availability = await serviceService.getServiceAvailability(serviceId, false);
    sendResponse(res, 200, true, "Availability retrieved successfully", availability);
  } catch (error) {
    next(error);
  }
};

export const getServicePricing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const pricing = await serviceService.getServicePricing(serviceId, false);
    sendResponse(res, 200, true, "Pricing retrieved successfully", pricing);
  } catch (error) {
    next(error);
  }
};

export const getAdminServices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawQuery = (res.locals.query || req.query) as any;
    const query: GetServicesQuery = {
      page: rawQuery.page !== undefined ? Number(rawQuery.page) : undefined,
      limit: rawQuery.limit !== undefined ? Number(rawQuery.limit) : undefined,
      type: rawQuery.type as any,
      status: rawQuery.status as any,
      search: (rawQuery.search || rawQuery.q) as string | undefined,
      q: rawQuery.q as string | undefined,
      sortBy: rawQuery.sortBy as any,
      sortOrder: rawQuery.sortOrder as any,
    };
    const result = await serviceService.getAdminServices(query);
    sendResponse(res, 200, true, "Admin services retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const bulkUpdateServiceStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data: BulkUpdateServiceStatusInput = req.body;
    const result = await serviceService.bulkUpdateServicesStatus(data);
    sendResponse(res, 200, true, "Services status updated successfully", result);
  } catch (error) {
    next(error);
  }
};

export const createService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data: CreateServiceInput = req.body;
    const service = await serviceService.createNewService(data);
    sendResponse(res, 201, true, "Service created successfully", service);
  } catch (error) {
    next(error);
  }
};

export const getAdminService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const service = await serviceService.getServiceDetails(serviceId, true);
    sendResponse(res, 200, true, "Admin service details retrieved successfully", service);
  } catch (error) {
    next(error);
  }
};

export const updateService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const data: UpdateServiceInput = req.body;
    const service = await serviceService.updateExistingService(serviceId, data);
    sendResponse(res, 200, true, "Service updated successfully", service);
  } catch (error) {
    next(error);
  }
};

export const updateServiceStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const data: UpdateServiceStatusInput = req.body;
    const service = await serviceService.changeServiceStatus(serviceId, data);
    sendResponse(res, 200, true, "Service status updated successfully", service);
  } catch (error) {
    next(error);
  }
};

export const getAdminAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawServiceId = req.query.serviceId;
    const serviceId = Array.isArray(rawServiceId) ? rawServiceId[0] : rawServiceId;
    
    const availability = await serviceService.getAdminAvailabilityOverview(serviceId as string || undefined);
    sendResponse(res, 200, true, "Admin availability overview retrieved successfully", availability);
  } catch (error) {
    next(error);
  }
};

export const updateAdminAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const data: AvailabilityUpdateInput = req.body;
    const availability = await serviceService.updateServiceAvailabilityManual(serviceId, data);
    sendResponse(res, 200, true, "Availability updated successfully", availability);
  } catch (error) {
    next(error);
  }
};

export const getAdminPricing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const pricing = await serviceService.getServicePricing(serviceId, true);
    sendResponse(res, 200, true, "Admin pricing retrieved successfully", pricing);
  } catch (error) {
    next(error);
  }
};

export const updateAdminPricing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const data: PricingUpdateInput = req.body;
    const pricing = await serviceService.updateServicePricingManual(serviceId, data);
    sendResponse(res, 200, true, "Pricing updated successfully", pricing);
  } catch (error) {
    next(error);
  }
};

export const deleteAdminService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const result = await serviceService.deleteService(serviceId);
    sendResponse(res, 200, true, "Tour package deleted successfully", result);
  } catch (error) {
    next(error);
  }
};

// ========================================================
// SERVICE PACKAGES
// ========================================================

export const getServicePackages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const isAdmin = req.user?.role === "admin" || req.user?.role === "staff";
    const packages = await serviceService.getServicePackages(serviceId, isAdmin);
    sendResponse(res, 200, true, "Service packages retrieved successfully", packages);
  } catch (error) {
    next(error);
  }
};

export const createAdminServicePackage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const pkg = await serviceService.createServicePackage(serviceId, req.body);
    sendResponse(res, 201, true, "Service package created successfully", pkg);
  } catch (error) {
    next(error);
  }
};

export const updateAdminServicePackage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { serviceId, packageId } = req.params as { serviceId: string; packageId: string };
    const pkg = await serviceService.updateServicePackage(serviceId, packageId, req.body);
    sendResponse(res, 200, true, "Service package updated successfully", pkg);
  } catch (error) {
    next(error);
  }
};

export const deleteAdminServicePackage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { serviceId, packageId } = req.params as { serviceId: string; packageId: string };
    await serviceService.deleteServicePackage(serviceId, packageId);
    sendResponse(res, 200, true, "Service package deleted successfully");
  } catch (error) {
    next(error);
  }
};

// ========================================================
// SERVICE TIME SLOTS
// ========================================================

export const getServiceTimeSlots = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const isAdmin = req.user?.role === "admin" || req.user?.role === "staff";
    const slots = await serviceService.getServiceTimeSlots(serviceId, isAdmin);
    sendResponse(res, 200, true, "Service time slots retrieved successfully", slots);
  } catch (error) {
    next(error);
  }
};

export const createAdminServiceTimeSlot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string;
    const slot = await serviceService.createServiceTimeSlot(serviceId, req.body);
    sendResponse(res, 201, true, "Service time slot created successfully", slot);
  } catch (error) {
    next(error);
  }
};

export const updateAdminServiceTimeSlot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { serviceId, slotId } = req.params as { serviceId: string; slotId: string };
    const slot = await serviceService.updateServiceTimeSlot(serviceId, slotId, req.body);
    sendResponse(res, 200, true, "Service time slot updated successfully", slot);
  } catch (error) {
    next(error);
  }
};

export const deleteAdminServiceTimeSlot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { serviceId, slotId } = req.params as { serviceId: string; slotId: string };
    await serviceService.deleteServiceTimeSlot(serviceId, slotId);
    sendResponse(res, 200, true, "Service time slot deleted successfully");
  } catch (error) {
    next(error);
  }
};

// ========================================================
// PICKUP ZONES
// ========================================================

export const getPickupZones = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string | undefined;
    const isAdmin = req.user?.role === "admin" || req.user?.role === "staff";
    const zones = await serviceService.getPickupZones(serviceId, isAdmin);
    sendResponse(res, 200, true, "Pickup zones retrieved successfully", zones);
  } catch (error) {
    next(error);
  }
};

export const createAdminPickupZone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const serviceId = req.params.serviceId as string | undefined;
    const zone = await serviceService.createPickupZone({
      ...req.body,
      ...(serviceId ? { serviceId } : {}),
    });
    sendResponse(res, 201, true, "Pickup zone created successfully", zone);
  } catch (error) {
    next(error);
  }
};

export const updateAdminPickupZone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    const zone = await serviceService.updatePickupZone(zoneId, req.body);
    sendResponse(res, 200, true, "Pickup zone updated successfully", zone);
  } catch (error) {
    next(error);
  }
};

export const deleteAdminPickupZone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zoneId = req.params.zoneId as string;
    await serviceService.deletePickupZone(zoneId);
    sendResponse(res, 200, true, "Pickup zone deleted successfully");
  } catch (error) {
    next(error);
  }
};