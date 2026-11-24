import AppError from "../../shared/utils/AppError.js";
import * as serviceRepository from "./serviceRepository.js";
import type {
  CreateServiceInput,
  UpdateServiceInput,
  UpdateServiceStatusInput,
  AvailabilityUpdateInput,
  PricingUpdateInput,
  GetServicesQuery,
  BulkUpdateServiceStatusInput,
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

export const bulkUpdateServicesStatus = async (data: BulkUpdateServiceStatusInput) => {
  return serviceRepository.bulkUpdateServiceStatus(data);
};

export const deleteService = async (id: string) => {
  // 1. Verify existence
  const service = await getServiceDetails(id, true);

  // 2. Verify no bookings exist
  const bookingCount = await serviceRepository.countServiceBookings(id);
  if (bookingCount > 0) {
    throw new AppError(
      `Cannot delete tour "${service.name}" because it has ${bookingCount} existing ${
        bookingCount === 1 ? "booking" : "bookings"
      }. Please move the tour to Draft or Unpublished status instead.`,
      400
    );
  }

  // 3. Delegate atomic deletion
  return serviceRepository.deleteServiceRecord(id);
};

// ========================================================
// SERVICE PACKAGES
// ========================================================

export const getServicePackages = async (serviceId: string, isAdmin = false) => {
  await getServiceDetails(serviceId, isAdmin);
  return serviceRepository.findPackagesByServiceId(serviceId, isAdmin);
};

export const createServicePackage = async (serviceId: string, data: any) => {
  await getServiceDetails(serviceId, true);
  return serviceRepository.createPackageRecord(serviceId, data);
};

export const updateServicePackage = async (serviceId: string, packageId: string, data: any) => {
  await getServiceDetails(serviceId, true);
  return serviceRepository.updatePackageRecord(packageId, data);
};

export const deleteServicePackage = async (serviceId: string, packageId: string) => {
  await getServiceDetails(serviceId, true);
  return serviceRepository.deletePackageRecord(packageId);
};

// ========================================================
// SERVICE TIME SLOTS
// ========================================================

export const getServiceTimeSlots = async (serviceId: string, isAdmin = false) => {
  await getServiceDetails(serviceId, isAdmin);
  return serviceRepository.findTimeSlotsByServiceId(serviceId, isAdmin);
};

export const createServiceTimeSlot = async (serviceId: string, data: any) => {
  await getServiceDetails(serviceId, true);
  return serviceRepository.createTimeSlotRecord(serviceId, data);
};

export const updateServiceTimeSlot = async (serviceId: string, slotId: string, data: any) => {
  await getServiceDetails(serviceId, true);
  return serviceRepository.updateTimeSlotRecord(slotId, data);
};

export const deleteServiceTimeSlot = async (serviceId: string, slotId: string) => {
  await getServiceDetails(serviceId, true);
  return serviceRepository.deleteTimeSlotRecord(slotId);
};

// ========================================================
// PICKUP ZONES
// ========================================================

export const getPickupZones = async (serviceId?: string, isAdmin = false) => {
  if (serviceId) {
    await getServiceDetails(serviceId, isAdmin);
  }
  return serviceRepository.findPickupZones(serviceId, isAdmin);
};

export const createPickupZone = async (data: any) => {
  if (data.serviceId) {
    await getServiceDetails(data.serviceId, true);
  }
  return serviceRepository.createPickupZoneRecord(data);
};

export const updatePickupZone = async (zoneId: string, data: any) => {
  if (data.serviceId) {
    await getServiceDetails(data.serviceId, true);
  }
  return serviceRepository.updatePickupZoneRecord(zoneId, data);
};

export const deletePickupZone = async (zoneId: string) => {
  return serviceRepository.deletePickupZoneRecord(zoneId);
};