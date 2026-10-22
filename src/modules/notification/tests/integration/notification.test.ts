import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import * as notificationService from "../../notificationService.js";

vi.mock("../../notificationService.js");
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-mock-role"] as string;
    req.user = { id: `${role}-1`, role };
    next();
  },
}));

const PATH = "/api/v1/admin/notification-settings";

describe("Notification Settings API Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["get", "customer"],
    ["get", "agent"],
    ["get", "staff"],
    ["put", "customer"],
    ["put", "agent"],
    ["put", "staff"],
  ] as const)("%s returns 403 for %s", async (method, role) => {
    const req = request(app)[method](PATH).set("x-mock-role", role);
    const res = await (method === "put"
      ? req.send({ settings: [{ event: "BOOKING_CONFIRMATION", enabled: true }] })
      : req);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("GET returns 200 for an admin", async () => {
    vi.mocked(notificationService.getSettings).mockResolvedValue({ settings: [] } as any);
    const res = await request(app).get(PATH).set("x-mock-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Notification settings retrieved successfully");
  });

  it("PUT returns 200 and forwards the admin id and body", async () => {
    vi.mocked(notificationService.updateSettings).mockResolvedValue({ settings: [] } as any);
    const body = { settings: [{ event: "PAYMENT_CONFIRMATION", enabled: false }] };

    const res = await request(app).put(PATH).set("x-mock-role", "admin").send(body);

    expect(res.status).toBe(200);
    expect(notificationService.updateSettings).toHaveBeenCalledWith(
      "admin-1",
      expect.objectContaining({ settings: expect.any(Array) }),
    );
  });

  it.each([
    ["missing settings", {}],
    ["empty settings", { settings: [] }],
    ["invalid event", { settings: [{ event: "SPAM", enabled: true }] }],
    ["missing enabled", { settings: [{ event: "BOOKING_CONFIRMATION" }] }],
    [
      "duplicate events",
      {
        settings: [
          { event: "BOOKING_CONFIRMATION", enabled: true },
          { event: "BOOKING_CONFIRMATION", enabled: false },
        ],
      },
    ],
  ])("PUT returns 400 for %s", async (_label, body) => {
    const res = await request(app).put(PATH).set("x-mock-role", "admin").send(body);
    expect(res.status).toBe(400);
    expect(notificationService.updateSettings).not.toHaveBeenCalled();
  });
});