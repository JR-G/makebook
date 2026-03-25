/** API key generation, validation, and hashing for MakeBook agents. */

import { createHash, randomBytes } from "node:crypto";

/** Prefix for all MakeBook API keys. */
export const API_KEY_PREFIX = "makebook_" as const;

/** Number of random bytes used to generate an API key (produces 64 hex chars). */
export const API_KEY_BYTE_LENGTH = 32 as const;

/**
 * Generates a cryptographically secure MakeBook API key.
 *
 * @remarks
 * Uses `crypto.randomBytes` to produce 32 bytes of entropy, encoded as 64
 * lowercase hex characters, prepended with {@link API_KEY_PREFIX}.
 *
 * @returns A 73-character API key string (`"makebook_"` + 64 hex chars).
 */
export function generateApiKey(): string {
  const raw = randomBytes(API_KEY_BYTE_LENGTH).toString("hex");
  return `${API_KEY_PREFIX}${raw}`;
}

/**
 * Checks whether a string matches the expected MakeBook API key format.
 *
 * @remarks
 * Validates the prefix, suffix length, and character set. Does not verify
 * the key against a stored hash — use {@link hashApiKey} for storage and
 * compare hashes yourself.
 *
 * @param key - The string to validate.
 * @returns `true` only if the key has the correct prefix, a 64-character
 * lowercase hex suffix, and no other characters.
 */
export function isValidApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) {
    return false;
  }

  const suffix = key.slice(API_KEY_PREFIX.length);
  const expectedSuffixLength = API_KEY_BYTE_LENGTH * 2;

  if (suffix.length !== expectedSuffixLength) {
    return false;
  }

  return /^[a-f0-9]+$/.test(suffix);
}

/**
 * Extracts and validates an API key from an Authorization header value.
 *
 * @remarks
 * Accepts two formats:
 * - `"Bearer makebook_<hex>"` — standard Bearer token header
 * - `"makebook_<hex>"` — bare key (no Bearer prefix)
 *
 * The `"Bearer "` prefix match is case-sensitive. The extracted key is
 * trimmed and validated with {@link isValidApiKeyFormat} before returning.
 *
 * @param authHeader - The raw `Authorization` header value, or `undefined`.
 * @returns The extracted API key string, or `null` if the header is absent,
 * empty, or contains an invalid key.
 */
export function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const BEARER_PREFIX = "Bearer ";

  let candidate: string;

  if (authHeader.startsWith(BEARER_PREFIX)) {
    candidate = authHeader.slice(BEARER_PREFIX.length).trim();
  } else if (authHeader.startsWith(API_KEY_PREFIX)) {
    candidate = authHeader.trim();
  } else {
    return null;
  }

  if (!isValidApiKeyFormat(candidate)) {
    return null;
  }

  return candidate;
}

/**
 * Hashes an API key using SHA-256 for safe database storage.
 *
 * @remarks
 * SHA-256 is appropriate here because MakeBook API keys are 256-bit
 * cryptographically random strings, making brute-force and rainbow table
 * attacks computationally infeasible. The resulting hash is stored in the
 * `agents.api_key_hash` column.
 *
 * @param key - The plain-text API key to hash.
 * @returns A 64-character lowercase hex string.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
