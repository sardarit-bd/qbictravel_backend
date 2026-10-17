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
} from "./serviceTypes.js";

export const getServices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query: GetServicesQuery = {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      type: req.query.type as any,
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
    const query: GetServicesQuery = {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      type: req.query.type as any,
    };
    const result = await serviceService.getAdminServices(query);
    sendResponse(res, 200, true, "Admin services retrieved successfully", result);
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