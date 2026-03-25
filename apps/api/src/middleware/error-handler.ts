import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";

/** Shape of an error with an optional HTTP status code. */
interface HttpError {
  message?: string;
  statusCode?: number;
  status?: number;
  stack?: string;
}

/**
 * Determines the HTTP status code from an unknown error value.
 * Accepts either `statusCode` or `status` properties.
 * @param error - The error to inspect.
 * @returns A valid HTTP status code in the 4xx–5xx range, defaulting to 500.
 */
function resolveStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null) {
    return 500;
  }

  const httpError = error as HttpError;
  const code = httpError.statusCode ?? httpError.status;

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
 * Creates a global Express error handler.
 * Returns a consistent `{ success: false, error }` JSON response for all errors.
 * In development mode the stack trace is included in the response.
 * @param nodeEnv - The current Node.js environment (e.g. "development", "production").
 * @returns An Express ErrorRequestHandler.
 */
export function createErrorHandler(nodeEnv: string): ErrorRequestHandler {
  return (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ): void => {
    const statusCode = resolveStatusCode(error);
    const message = resolveMessage(error);

    process.stderr.write(`[error] ${statusCode} ${message}\n`);

    const body: Record<string, unknown> = { success: false, error: message };

    if (nodeEnv === "development" && error instanceof Error && error.stack) {
      body["stack"] = error.stack;
    }

    response.status(statusCode).json(body);
  };
}
