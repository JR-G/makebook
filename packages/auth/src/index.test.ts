import { describe, test, expect } from "bun:test";
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  isApiKeyFormat,
  API_KEY_PREFIX,
  API_KEY_LENGTH,
} from "./index.ts";

describe("API_KEY_PREFIX", () => {
  test("is mk_", () => {
    expect(API_KEY_PREFIX).toBe("mk_");
  });
});

describe("API_KEY_LENGTH", () => {
  test("is 67 characters (3 prefix + 64 hex)", () => {
    expect(API_KEY_LENGTH).toBe(67);
  });
});

describe("generateApiKey", () => {
  test("returns an object with key and hash properties", () => {
    const result = generateApiKey();
    expect(result).toHaveProperty("key");
    expect(result).toHaveProperty("hash");
  });

  test("key starts with the mk_ prefix", () => {
    const { key } = generateApiKey();
    expect(key.startsWith("mk_")).toBe(true);
  });

  test("key has the correct total length", () => {
    const { key } = generateApiKey();
    expect(key.length).toBe(API_KEY_LENGTH);
  });

  test("hash is a 64-character hex string", () => {
    const { hash } = generateApiKey();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("hash matches hashApiKey(key)", () => {
    const { key, hash } = generateApiKey();
    expect(hash).toBe(hashApiKey(key));
  });

  test("successive calls produce different keys", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.key).not.toBe(second.key);
  });

  test("successive calls produce different hashes", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.hash).not.toBe(second.hash);
  });
});

describe("hashApiKey", () => {
  test("returns a 64-character string", () => {
    const hash = hashApiKey("mk_abc123");
    expect(hash.length).toBe(64);
  });

  test("returns only lowercase hex characters", () => {
    const hash = hashApiKey("mk_abc123");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  test("is deterministic for the same input", () => {
    const key = "mk_repeatablekey";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  test("produces different hashes for different inputs", () => {
    expect(hashApiKey("mk_aaa")).not.toBe(hashApiKey("mk_bbb"));
  });

  test("a real generated key hashes consistently", () => {
    const { key, hash } = generateApiKey();
    expect(hashApiKey(key)).toBe(hash);
    expect(hashApiKey(key)).toBe(hash);
  });
});

describe("isApiKeyFormat", () => {
  test("returns true for a valid generated key", () => {
    const { key } = generateApiKey();
    expect(isApiKeyFormat(key)).toBe(true);
  });

  test("returns false for an empty string", () => {
    expect(isApiKeyFormat("")).toBe(false);
  });

  test("returns false when prefix is missing", () => {
    const { key } = generateApiKey();
    const withoutPrefix = key.slice(API_KEY_PREFIX.length);
    expect(isApiKeyFormat(withoutPrefix)).toBe(false);
  });

  test("returns false when prefix is wrong", () => {
    const { key } = generateApiKey();
    const wrongPrefix = `xx_${key.slice(API_KEY_PREFIX.length)}`;
    expect(isApiKeyFormat(wrongPrefix)).toBe(false);
  });

  test("returns false when key is too short", () => {
    expect(isApiKeyFormat("mk_short")).toBe(false);
  });

  test("returns false when key is one character too long", () => {
    const { key } = generateApiKey();
    expect(isApiKeyFormat(`${key}x`)).toBe(false);
  });

  test("returns false when key is one character too short", () => {
    const { key } = generateApiKey();
    expect(isApiKeyFormat(key.slice(0, -1))).toBe(false);
  });
});

describe("verifyApiKey", () => {
  test("returns valid: true for a correct key and hash", () => {
    const { key, hash } = generateApiKey();
    const result = verifyApiKey(key, hash);
    expect(result.valid).toBe(true);
  });

  test("returns valid: false with reason for a wrong hash", () => {
    const { key } = generateApiKey();
    const { hash: otherHash } = generateApiKey();
    const result = verifyApiKey(key, otherHash);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("key does not match");
    }
  });

  test("returns valid: false with reason for invalid format", () => {
    const result = verifyApiKey("not-a-valid-key", "somehash");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("invalid key format");
    }
  });

  test("returns valid: false for empty key", () => {
    const { hash } = generateApiKey();
    const result = verifyApiKey("", hash);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("invalid key format");
    }
  });

  test("returns valid: false for key with wrong prefix", () => {
    const { key, hash } = generateApiKey();
    const wrongPrefixKey = `xx_${key.slice(API_KEY_PREFIX.length)}`;
    const result = verifyApiKey(wrongPrefixKey, hash);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("invalid key format");
    }
  });

  test("returns valid: false when hash is not valid hex", () => {
    const { key } = generateApiKey();
    const result = verifyApiKey(key, "not-a-valid-hash");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("key does not match");
    }
  });

  test("returns valid: false for a tampered key", () => {
    const { key, hash } = generateApiKey();
    const tampered = `${key.slice(0, -1)}x`;
    const result = verifyApiKey(tampered, hash);
    expect(result.valid).toBe(false);
  });

  test("returns valid: false when hash is an empty string", () => {
    const { key } = generateApiKey();
    const result = verifyApiKey(key, "");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("key does not match");
    }
  });

  test("discriminated union: reason only exists on invalid result", () => {
    const { key, hash } = generateApiKey();
    const validResult = verifyApiKey(key, hash);
    const invalidResult = verifyApiKey("bad", hash);

    expect(validResult.valid).toBe(true);
    expect(invalidResult.valid).toBe(false);

    if (!invalidResult.valid) {
      expect(typeof invalidResult.reason).toBe("string");
    }
  });
});
