import { describe, test, expect } from "bun:test";
import { AesGcmCipher } from "./credential-cipher.ts";

const TEST_KEY = Buffer.from("a".repeat(64), "hex"); // 32 bytes of 0xaa

describe("AesGcmCipher", () => {
  test("decrypt reverses encrypt for a typical credential", () => {
    const cipher = new AesGcmCipher(TEST_KEY);
    const plaintext = "fly-api-token-abc123";

    expect(cipher.decrypt(cipher.encrypt(plaintext))).toBe(plaintext);
  });

  test("each encrypt call produces a different ciphertext (fresh IV)", () => {
    const cipher = new AesGcmCipher(TEST_KEY);
    const first = cipher.encrypt("same-value");
    const second = cipher.encrypt("same-value");

    expect(first).not.toBe(second);
  });

  test("decrypt returns original plaintext after double round-trip", () => {
    const cipher = new AesGcmCipher(TEST_KEY);
    const original = "e2b-key-xyz-9876";
    const ciphertext = cipher.encrypt(original);

    expect(cipher.decrypt(ciphertext)).toBe(original);
    expect(cipher.decrypt(ciphertext)).toBe(original);
  });

  test("throws when key is shorter than 32 bytes", () => {
    const shortKey = Buffer.alloc(16);

    expect(() => new AesGcmCipher(shortKey)).toThrow(
      "AesGcmCipher: key must be 32 bytes",
    );
  });

  test("throws when key is longer than 32 bytes", () => {
    const longKey = Buffer.alloc(64);

    expect(() => new AesGcmCipher(longKey)).toThrow(
      "AesGcmCipher: key must be 32 bytes",
    );
  });

  test("decrypt throws on tampered ciphertext (auth tag mismatch)", () => {
    const cipher = new AesGcmCipher(TEST_KEY);
    const ciphertext = cipher.encrypt("sensitive-key");
    const tampered = Buffer.from(ciphertext, "base64");
    const lastByte = tampered[tampered.length - 1];
    if (lastByte !== undefined) {
      tampered[tampered.length - 1] = lastByte ^ 0xff;
    }

    expect(() => cipher.decrypt(tampered.toString("base64"))).toThrow();
  });

  test("handles empty string plaintext", () => {
    const cipher = new AesGcmCipher(TEST_KEY);

    expect(cipher.decrypt(cipher.encrypt(""))).toBe("");
  });

  test("handles unicode / special character credentials", () => {
    const cipher = new AesGcmCipher(TEST_KEY);
    const unicode = "key-with-特殊字符-and-émojis-🔑";

    expect(cipher.decrypt(cipher.encrypt(unicode))).toBe(unicode);
  });
});
