import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as serviceRepository from "../../serviceRepository.js";
import * as serviceService from "../../serviceService.js";
import type { CreateServiceInput, ServiceRecord } from "../../serviceTypes.js";

vi.mock("../../serviceRepository.js");

const mockedRepo = vi.mocked(serviceRepository);

describe("Service Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getServiceDetails", () => {
    it("should return service details if found", async () => {
      const mockService = {
        id: "1",
        name: "Test Hotel",
        status: "PUBLISHED",
      } as ServiceRecord;
      mockedRepo.findServiceById.mockResolvedValue(mockService as any);

      const result = await serviceService.getServiceDetails("1", false);

      expect(result).toEqual(mockService);
      expect(mockedRepo.findServiceById).toHaveBeenCalledWith("1", false);
    });

    it("should throw 404 AppError if service is not found", async () => {
      mockedRepo.findServiceById.mockResolvedValue(null);

      await expect(
        serviceService.getServiceDetails("999", false),
      ).rejects.toThrow(new AppError("Service not found", 404));
    });
  });

  describe("createNewService", () => {
    it("should create and return a new service", async () => {
      const inputData: CreateServiceInput = { name: "New Tour", type: "TOUR" };
      const mockCreated = {
        id: "2",
        ...inputData,
        status: "DRAFT",
      } as ServiceRecord;

      mockedRepo.createServiceRecord.mockResolvedValue(mockCreated);

      const result = await serviceService.createNewService(inputData);

      expect(result).toEqual(mockCreated);
      expect(mockedRepo.createServiceRecord).toHaveBeenCalledWith(inputData);
    });
  });

  describe("updateExistingService", () => {
    it("should throw 404 if service does not exist", async () => {
      mockedRepo.findServiceById.mockResolvedValue(null);

      await expect(
        serviceService.updateExistingService("999", { name: "Updated" }),
      ).rejects.toThrow(new AppError("Service not found", 404));
    });

    it("should update and return the service if it exists", async () => {
      const mockExisting = { id: "1", name: "Old Name" } as ServiceRecord;
      const mockUpdated = { id: "1", name: "New Name" } as ServiceRecord;

      mockedRepo.findServiceById.mockResolvedValue(mockExisting as any);
      mockedRepo.updateServiceRecord.mockResolvedValue(mockUpdated);

      const result = await serviceService.updateExistingService("1", {
        name: "New Name",
      });

      expect(result).toEqual(mockUpdated);
      expect(mockedRepo.updateServiceRecord).toHaveBeenCalledWith("1", {
        name: "New Name",
      });
    });
  });

  describe("changeServiceStatus", () => {
    it("should update the status of an existing service", async () => {
      const mockExisting = { id: "1", status: "DRAFT" } as ServiceRecord;
      const mockUpdated = { id: "1", status: "PUBLISHED" } as ServiceRecord;

      mockedRepo.findServiceById.mockResolvedValue(mockExisting as any);
      mockedRepo.updateServiceStatusRecord.mockResolvedValue(mockUpdated);

      const result = await serviceService.changeServiceStatus("1", {
        status: "PUBLISHED",
      });

      expect(result.status).toBe("PUBLISHED");
      expect(mockedRepo.updateServiceStatusRecord).toHaveBeenCalledWith("1", {
        status: "PUBLISHED",
      });
    });
  });
});
