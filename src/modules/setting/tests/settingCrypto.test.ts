import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  isMaskedValue,
  verifyWebhookSignature,
} from "../settingCrypto.js";

describe("Setting Cryptography & Masking", () => {
  const secretKey = "test-secret-key-12345678901234567890";

  it("should encrypt and decrypt a plaintext secret correctly", () => {
    const plaintext = "sk_live_very_secret_api_key_phukettours_2026";
    const encrypted = encryptSecret(plaintext, secretKey);

    expect(encrypted).not.toEqual(plaintext);
    expect(encrypted.split(":")).toHaveLength(3);

    const decrypted = decryptSecret(encrypted, secretKey);
    expect(decrypted).toEqual(plaintext);
  });

  it("should fail decryption when ciphertext or auth tag is tampered with", () => {
    const plaintext = "my-super-secret-password";
    const encrypted = encryptSecret(plaintext, secretKey);
    const [iv, tag, ciphertext] = encrypted.split(":");

    // Tamper with tag
    const tamperedTag = tag.slice(0, -2) + "ff";
    expect(() => {
      decryptSecret(`${iv}:${tamperedTag}:${ciphertext}`, secretKey);
    }).toThrow();

    // Tamper with ciphertext
    const tamperedCiphertext = ciphertext.slice(0, -2) + "aa";
    expect(() => {
      decryptSecret(`${iv}:${tag}:${tamperedCiphertext}`, secretKey);
    }).toThrow();
  });

  it("should fail decryption when a different key is provided", () => {
    const plaintext = "critical_smtp_password";
    const encrypted = encryptSecret(plaintext, secretKey);

    expect(() => {
      decryptSecret(encrypted, "completely-wrong-master-key");
    }).toThrow();
  });

  it("should properly mask secrets with tail exposure", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("abc")).toBe("••••••••");
    expect(maskSecret("abcdef")).toBe("••••••••••••cdef");
    expect(maskSecret("sk_live_9876543210")).toBe("••••••••••••3210");
  });

  it("should identify masked values correctly", () => {
    expect(isMaskedValue("••••••••")).toBe(true);
    expect(isMaskedValue("••••••••••••3210")).toBe(true);
    expect(isMaskedValue("sk_live_9876543210")).toBe(false);
    expect(isMaskedValue("")).toBe(false);
  });

  it("should verify HMAC SHA-256 webhook signatures properly", () => {
    const payload = JSON.stringify({ id: "evt_123", amount: 1500, status: "completed" });
    const signingSecret = "whsec_phukettours_secure_secret";

    // Compute expected HMAC in hex
    const crypto = require("crypto");
    const hmac = crypto.createHmac("sha256", signingSecret).update(payload).digest("hex");

    expect(verifyWebhookSignature(payload, hmac, signingSecret)).toBe(true);
    expect(verifyWebhookSignature(payload, `sha256=${hmac}`, signingSecret)).toBe(true);
    expect(verifyWebhookSignature(payload, "invalid_signature", signingSecret)).toBe(false);
    expect(verifyWebhookSignature(payload + "tampered", hmac, signingSecret)).toBe(false);
  });
});
