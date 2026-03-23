import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";

/** Shape of an error with an HTTP status code. */
interface HttpError {
  message?: string;
  statusCode?: number;
}

/**
 * Determines the HTTP status code from an unknown error value.
 * @param error - The error to inspect.
 * @returns A valid HTTP status code, defaulting to 500.
 */
function resolveStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null) {
    return 500;
  }

  const httpError = error as HttpError;
  const code = httpError.statusCode;

  if (typeof code === "number" && code >= 400 && code < 600) {
    return code;
  }

  return 500;
}

/**
 * Extracts a human-readable message from an unknown error value.
 * @param error - The error to inspect.
 * @returns A string message suitable for API responses.
 */
function resolveMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const httpError = error as HttpError;
    return httpError.message ?? "Internal server error";
  }

  return "Internal server error";
}

/**
 * Global Express error handler. Returns a consistent JSON error response
 * for all unhandled errors passed to next(error).
 * @returns An Express ErrorRequestHandler.
 */
export function errorHandler(): ErrorRequestHandler {
  return (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ): void => {
    const statusCode = resolveStatusCode(error);
    const message = resolveMessage(error);
    response.status(statusCode).json({ error: message });
  };
}
