import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as customerRepository from "../../customerRepository.js";
import * as customerService from "../../customerService.js";

vi.mock("../../customerRepository.js");

const repo = vi.mocked(customerRepository);

describe("customerService unit tests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("listCustomerBookings", () => {
    it("delegates to customerRepository with customerId and params", async () => {
      const mockList = {
        items: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      };
      repo.listCustomerBookings.mockResolvedValue(mockList);

      const result = await customerService.listCustomerBookings("cust-1", {
        page: 1,
        limit: 10,
      });
      expect(result).toEqual(mockList);
      expect(repo.listCustomerBookings).toHaveBeenCalledWith("cust-1", {
        page: 1,
        limit: 10,
      });
    });
  });

  describe("getCustomerBooking", () => {
    it("returns booking when found for the customer", async () => {
      const mockBooking: any = {
        id: "bk-1",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        finalPrice: 1200,
      };
      repo.findCustomerBookingById.mockResolvedValue(mockBooking);

      const result = await customerService.getCustomerBooking("cust-1", "bk-1");
      expect(result).toEqual(mockBooking);
      expect(repo.findCustomerBookingById).toHaveBeenCalledWith("cust-1", "bk-1");
    });

    it("throws 404 when the booking is not owned by the customer", async () => {
      repo.findCustomerBookingById.mockResolvedValue(null);

      await expect(
        customerService.getCustomerBooking("cust-1", "bk-999")
      ).rejects.toThrow(AppError);
    });
  });
});
