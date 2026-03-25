/** API key generation, validation, and hashing for MakeBook agents. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIX = "mk_";
const KEY_BYTES = 32;

/** A generated API key pair: the plain key and its SHA-256 hash for storage. */
export interface GeneratedApiKey {
  /** Plain-text key to give to the agent exactly once. */
  key: string;
  /** SHA-256 hash of the key for database storage. */
  hash: string;
}

/** Result of verifying an API key against its stored hash. */
export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: string };

/** The prefix used for all MakeBook API keys. */
export const API_KEY_PREFIX = KEY_PREFIX;

/** The total expected length of a MakeBook API key string. */
export const API_KEY_LENGTH = KEY_PREFIX.length + KEY_BYTES * 2;

/**
 * Generates a cryptographically secure API key for a MakeBook agent.
 *
 * @remarks
 * Returns both the plain-text key (to give to the agent once and never store)
 * and its SHA-256 hash (to persist in the database for validation).
 *
 * @returns The plain-text key and its hash.
 */
export function generateApiKey(): GeneratedApiKey {
  const raw = randomBytes(KEY_BYTES).toString("hex");
  const key = `${KEY_PREFIX}${raw}`;
  return { key, hash: hashApiKey(key) };
}

/**
 * Hashes an API key using SHA-256 for safe database storage.
 *
 * @remarks
 * SHA-256 is appropriate here because MakeBook API keys are
 * 256-bit cryptographically random strings, making rainbow table
 * and brute-force attacks computationally infeasible.
 *
 * @param key - The plain-text API key to hash.
 * @returns A 64-character lowercase hex string.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Verifies a plain-text API key against its stored SHA-256 hash.
 *
 * @remarks
 * Uses constant-time comparison via `timingSafeEqual` to prevent
 * timing side-channel attacks.
 *
 * @param key - The plain-text key provided by the agent.
 * @param storedHash - The SHA-256 hash retrieved from the database.
 * @returns A discriminated union indicating whether the key is valid.
 */
export function verifyApiKey(key: string, storedHash: string): VerifyResult {
  if (!isApiKeyFormat(key)) {
    return { valid: false, reason: "invalid key format" };
  }

  const computedBuf = Buffer.from(hashApiKey(key), "hex");
  const storedBuf = Buffer.from(storedHash, "hex");
  const lengthsMatch = computedBuf.length === storedBuf.length;
  const keysMatch = lengthsMatch && timingSafeEqual(computedBuf, storedBuf);

  if (!keysMatch) {
    return { valid: false, reason: "key does not match" };
  }

  return { valid: true };
}

/**
 * Checks whether a string matches the expected MakeBook API key format.
 *
 * @remarks
 * Validates the prefix and length only. Does not check the key against
 * a stored hash — use {@link verifyApiKey} for full validation.
 *
 * @param value - The string to check.
 * @returns `true` if the string has the correct prefix and length.
 */
export function isApiKeyFormat(value: string): boolean {
  return value.startsWith(KEY_PREFIX) && value.length === API_KEY_LENGTH;
}
