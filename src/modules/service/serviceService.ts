import AppError from "../../shared/utils/AppError.js";
import * as serviceRepository from "./serviceRepository.js";
import type {
  CreateServiceInput,
  UpdateServiceInput,
  UpdateServiceStatusInput,
  AvailabilityUpdateInput,
  PricingUpdateInput,
  GetServicesQuery,
} from "./serviceTypes.js";

export const getPublishedServices = async (query: GetServicesQuery) => {
  return serviceRepository.findPublishedServices(query);
};

export const getServiceDetails = async (id: string, isAdmin = false) => {
  const service = await serviceRepository.findServiceById(id, isAdmin);
  if (!service) {
    throw new AppError("Service not found", 404);
  }
  return service;
};

export const getServiceAvailability = async (id: string, isAdmin = false) => {
  // Verify service exists and is published (unless admin)
  await getServiceDetails(id, isAdmin);
  return serviceRepository.findServiceAvailability(id);
};

export const getServicePricing = async (id: string, isAdmin = false) => {
  await getServiceDetails(id, isAdmin);
  return serviceRepository.findServicePricing(id);
};

export const getAdminServices = async (query: GetServicesQuery) => {
  return serviceRepository.findAdminServices(query);
};

export const createNewService = async (data: CreateServiceInput) => {
  return serviceRepository.createServiceRecord(data);
};

export const updateExistingService = async (id: string, data: UpdateServiceInput) => {
  // Verify exists
  await getServiceDetails(id, true);
  return serviceRepository.updateServiceRecord(id, data);
};

export const changeServiceStatus = async (id: string, data: UpdateServiceStatusInput) => {
  await getServiceDetails(id, true);
  return serviceRepository.updateServiceStatusRecord(id, data);
};

export const getAdminAvailabilityOverview = async (serviceId?: string) => {
  return serviceRepository.findAllAdminAvailability(serviceId);
};

export const updateServiceAvailabilityManual = async (id: string, data: AvailabilityUpdateInput) => {
  await getServiceDetails(id, true);
  return serviceRepository.upsertServiceAvailability(id, data);
};

export const updateServicePricingManual = async (id: string, data: PricingUpdateInput) => {
  await getServiceDetails(id, true);
  return serviceRepository.upsertServicePricing(id, data);
};