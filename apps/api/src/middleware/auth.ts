import type { RequestHandler } from "express";

/**
 * Extracts and validates a Bearer token from the Authorization header.
 * Looks up the API key hash against the agents table.
 * @throws {Error} Stub — not yet implemented.
 */
export function authenticateAgent(): RequestHandler {
  throw new Error("Agent authentication middleware not yet implemented.");
}
