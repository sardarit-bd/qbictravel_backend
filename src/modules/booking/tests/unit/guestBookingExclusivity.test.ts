import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGuestBooking } from "../../bookingController.js";
import { prisma } from "../../../../lib/prisma.js";
import { affiliateService } from "../../../affiliate/affiliateService.js";
import * as affiliateAttribution from "../../../affiliate/affiliateAttribution.js";
import * as bookingService from "../../bookingService.js";
import AppError from "../../../../shared/utils/AppError.js";

describe("createGuestBooking Affiliate Exclusivity", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      body: {
        customer: { name: "John Doe", email: "john@example.com" },
        serviceId: "srv-123",
      },
      cookies: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it("rejects guest booking with 403 when no affiliate attribution or referral code is present", async () => {
    vi.spyOn(affiliateAttribution, "getAttributionFromRequest").mockReturnValue(null);

    await createGuestBooking(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("Guest checkout is only available for affiliate-referred customers");
  });

  it("rejects guest booking with 403 when referral code is invalid or not approved", async () => {
    vi.spyOn(affiliateAttribution, "getAttributionFromRequest").mockReturnValue(null);
    req.body.referralCode = "ARBITRARY_FAKE_CODE";

    vi.spyOn(affiliateService, "validateCode").mockResolvedValue({
      valid: false,
      reason: "Invalid or inactive referral code",
    });

    await createGuestBooking(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain("Invalid or expired affiliate referral");
  });

  it("allows guest booking when valid referral code is present in request body", async () => {
    vi.spyOn(affiliateAttribution, "getAttributionFromRequest").mockReturnValue(null);
    req.body.referralCode = "AFFB5XAWS";

    vi.spyOn(affiliateService, "validateCode").mockResolvedValue({
      valid: true,
      code: "AFFB5XAWS",
      windowDays: 30,
    });

    vi.spyOn(bookingService, "createGuestBooking").mockResolvedValue({
      booking: { id: "bk-1", customerId: "cust-1" },
    } as any);

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
    vi.spyOn(affiliateService, "attachAttributionToBooking").mockResolvedValue({} as any);

    await createGuestBooking(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("allows guest booking when valid attribution cookie is present", async () => {
    vi.spyOn(affiliateAttribution, "getAttributionFromRequest").mockReturnValue({
      affiliateId: "aff-123",
      clickId: "clk-123",
      code: "AFFB5XAWS",
      exp: Date.now() + 86400000,
    });

    vi.spyOn(prisma.affiliate, "findUnique").mockResolvedValue({
      id: "aff-123",
      status: "APPROVED",
    } as any);

    vi.spyOn(bookingService, "createGuestBooking").mockResolvedValue({
      booking: { id: "bk-1", customerId: "cust-1" },
    } as any);

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(prisma));
    vi.spyOn(affiliateService, "attachAttributionToBooking").mockResolvedValue({} as any);

    await createGuestBooking(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
