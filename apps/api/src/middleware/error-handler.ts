import type { ErrorRequestHandler } from "express";

/**
 * Global Express error handler. Catches unhandled errors and returns
 * a consistent JSON error response.
 * @throws Stub — not yet implemented.
 */
export function errorHandler(): ErrorRequestHandler {
  throw new Error("Error handler middleware not yet implemented.");
}
