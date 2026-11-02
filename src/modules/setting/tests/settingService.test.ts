import { describe, it, expect, vi, beforeEach } from "vitest";
import * as settingService from "../settingService.js";
import * as repo from "../settingRepository.js";
import AppError from "../../../shared/utils/AppError.js";

vi.mock("../settingRepository.js");

describe("Setting Service Unit Tests", () => {
  const mockActor: settingService.ActorContext = {
    id: "user-admin-1",
    name: "Admin User",
    email: "admin@phukettours.com",
    ipAddress: "127.0.0.1",
    userAgent: "Mozilla/5.0 TestAgent",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Payment Settings Validation & Safety", () => {
    it("should throw an AppError if trying to switch to live mode without confirmLiveMode", async () => {
      await expect(
        settingService.updatePaymentSettings(
          {
            providerName: "Stripe",
            environment: "live",
            confirmLiveMode: false,
          },
          mockActor
        )
      ).rejects.toThrowError(/Confirmation is required before switching Payment Gateway to Live Mode/);
    });

    it("should allow switching to live mode when confirmLiveMode is explicitly true", async () => {
      vi.mocked(repo.setPlaintextSetting).mockResolvedValue({} as any);
      vi.mocked(repo.setSecretSetting).mockResolvedValue({} as any);
      vi.mocked(repo.logSettingAudit).mockResolvedValue({} as any);
      vi.mocked(repo.getAllSettings).mockResolvedValue([]);

      const result = await settingService.updatePaymentSettings(
        {
          providerName: "Stripe",
          environment: "live",
          confirmLiveMode: true,
          publishableKey: "pk_live_12345",
        },
        mockActor
      );

      expect(repo.setPlaintextSetting).toHaveBeenCalledWith(
        "PAYMENT",
        "payment.environment",
        "live",
        mockActor.id
      );
      expect(repo.logSettingAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "PAYMENT",
          action: "ACTIVATE_LIVE_PAYMENT_MODE",
          actorId: mockActor.id,
        })
      );
      expect(result).toBeDefined();
    });
  });

  describe("General Settings", () => {
    it("should update general settings and log audit event without exposing secrets", async () => {
      vi.mocked(repo.setPlaintextSetting).mockResolvedValue({} as any);
      vi.mocked(repo.logSettingAudit).mockResolvedValue({} as any);
      vi.mocked(repo.getAllSettings).mockResolvedValue([]);

      const result = await settingService.updateGeneralSettings(
        {
          platformName: "Phuket Luxury Tours",
          supportEmail: "help@phukettours.com",
          defaultCurrency: "thb",
          maintenanceMode: false,
        },
        mockActor
      );

      expect(repo.setPlaintextSetting).toHaveBeenCalledWith(
        "GENERAL",
        "general.platform_name",
        "Phuket Luxury Tours",
        mockActor.id
      );
      expect(repo.setPlaintextSetting).toHaveBeenCalledWith(
        "GENERAL",
        "general.default_currency",
        "THB",
        mockActor.id
      );
      expect(repo.logSettingAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "GENERAL",
          action: "UPDATE_GENERAL_SETTINGS",
        })
      );
      expect(result).toBeDefined();
    });
  });

  describe("Webhook Security & Verification", () => {
    it("should reject webhook with 503 if no webhook signing secret is configured", async () => {
      vi.mocked(repo.getDecryptedSecretSetting).mockResolvedValue(null);

      await expect(
        settingService.handlePaymentWebhook("{}", "some-sig")
      ).rejects.toThrowError(/Webhook verification unavailable/);
    });

    it("should reject webhook with 401 if signature is missing", async () => {
      vi.mocked(repo.getDecryptedSecretSetting).mockResolvedValue("test-signing-secret");
      vi.mocked(repo.setPlaintextSetting).mockResolvedValue({} as any);

      await expect(
        settingService.handlePaymentWebhook("{}", undefined)
      ).rejects.toThrowError(/Missing webhook signature/);
    });

    it("should reject webhook with 401 if signature does not match payload HMAC", async () => {
      vi.mocked(repo.getDecryptedSecretSetting).mockResolvedValue("test-signing-secret");
      vi.mocked(repo.setPlaintextSetting).mockResolvedValue({} as any);

      await expect(
        settingService.handlePaymentWebhook('{"id":"evt_1"}', "invalid_hex_signature")
      ).rejects.toThrowError(/Invalid webhook signature/);
    });
  });
});
