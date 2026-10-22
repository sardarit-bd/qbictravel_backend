import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as bookingRepository from "../../bookingRepository.js";
import * as bookingService from "../../bookingService.js";

vi.mock("../../bookingRepository.js");
vi.mock("../../../pricing/pricingService.js");
vi.mock("../../../notification/notificationService.js");
vi.mock("../../../../lib/prisma.js", () => ({
  prisma: { service: { findUnique: vi.fn() } },
}));

const repo = vi.mocked(bookingRepository);

const CUSTOMER_ID = "123e4567-e89b-12d3-a456-426614174010";
const OTHER_CUSTOMER_ID = "123e4567-e89b-12d3-a456-426614174011";
const AGENT_ID = "123e4567-e89b-12d3-a456-426614174012";
const SERVICE_ID = "123e4567-e89b-12d3-a456-426614174013";

const expectAppError = async (promise: Promise<unknown>, statusCode: number) => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode });
};

describe("bookingService.createBooking identity guards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when a customer books for another customer", async () => {
    await expectAppError(
      bookingService.createBooking(
        { customerId: OTHER_CUSTOMER_ID, serviceId: SERVICE_ID } as any,
        false,
        CUSTOMER_ID,
      ),
      403,
    );
    expect(repo.createBooking).not.toHaveBeenCalled();
  });

  it("returns 403 when a customer sends an agentId", async () => {
    await expectAppError(
      bookingService.createBooking(
        { customerId: CUSTOMER_ID, agentId: AGENT_ID, serviceId: SERVICE_ID } as any,
        false,
        CUSTOMER_ID,
      ),
      403,
    );
    expect(repo.createBooking).not.toHaveBeenCalled();
  });

  it("returns 404 when an agent books for an unknown or inactive customer", async () => {
    repo.findActiveCustomer.mockResolvedValue(null);
    await expectAppError(
      bookingService.createBooking(
        { customerId: CUSTOMER_ID, serviceId: SERVICE_ID, proposedPrice: 90 } as any,
        true,
        AGENT_ID,
      ),
      404,
    );
    expect(repo.createBooking).not.toHaveBeenCalled();
  });
});