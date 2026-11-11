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

    // Tamper with tag deterministically (flip the lowest bit of the first byte)
    const tagBuffer = Buffer.from(tag, "hex");
    tagBuffer[0] ^= 0x01;
    const tamperedTag = tagBuffer.toString("hex");

    expect(() => {
      decryptSecret(`${iv}:${tamperedTag}:${ciphertext}`, secretKey);
    }).toThrow(/Decryption failed/);

    // Tamper with ciphertext deterministically (flip the lowest bit of the first byte)
    const cipherBuffer = Buffer.from(ciphertext, "hex");
    cipherBuffer[0] ^= 0x01;
    const tamperedCiphertext = cipherBuffer.toString("hex");

    expect(() => {
      decryptSecret(`${iv}:${tag}:${tamperedCiphertext}`, secretKey);
    }).toThrow(/Decryption failed/);
  });

  it("should fail decryption on malformed payload or invalid IV/tag lengths", () => {
    const plaintext = "another-secret";
    const encrypted = encryptSecret(plaintext, secretKey);
    const [iv, tag, ciphertext] = encrypted.split(":");

    // Malformed structure (missing parts)
    expect(() => decryptSecret("not-a-valid-encrypted-string", secretKey)).toThrow(/Invalid ciphertext structure/);
    expect(() => decryptSecret(`${iv}:${tag}`, secretKey)).toThrow(/Invalid ciphertext structure/);
    expect(() => decryptSecret("", secretKey)).toThrow(/Ciphertext must be a valid formatted string/);

    // Non-hex characters
    expect(() => decryptSecret(`${iv}:${tag}:zzzzzzzz`, secretKey)).toThrow(/Non-hexadecimal characters/);
    expect(() => decryptSecret(`${iv}:invalidtag1234567890123456789012:${ciphertext}`, secretKey)).toThrow(/Non-hexadecimal characters/);

    // Invalid IV length (e.g. 8 bytes instead of 12)
    const shortIv = iv.slice(0, 16);
    expect(() => decryptSecret(`${shortIv}:${tag}:${ciphertext}`, secretKey)).toThrow(/Invalid initialization vector length/);

    // Invalid tag length (e.g. 12 bytes instead of 16)
    const shortTag = tag.slice(0, 24);
    expect(() => decryptSecret(`${iv}:${shortTag}:${ciphertext}`, secretKey)).toThrow(/Invalid authentication tag length/);
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
