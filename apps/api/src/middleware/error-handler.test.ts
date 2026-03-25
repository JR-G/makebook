import { describe, test, expect } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import { createErrorHandler } from "./error-handler.ts";

function invokeHandler(
  error: unknown,
  nodeEnv = "production",
): { statusCode: number | undefined; body: Record<string, unknown> } {
  const state: { statusCode: number | undefined; body: Record<string, unknown> } = {
    statusCode: undefined,
    body: {},
  };

  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(data: unknown) {
      state.body = data as Record<string, unknown>;
    },
  } as unknown as Response;

  const handler = createErrorHandler(nodeEnv);
  handler(
    error,
    {} as Request,
    response,
    (() => {}) as unknown as NextFunction,
  );

  return state;
}

describe("createErrorHandler", () => {
  test("returns 500 with { success: false, error } for a generic Error", () => {
    const { statusCode, body } = invokeHandler(new Error("Something broke"));
    expect(statusCode).toBe(500);
    expect(body).toMatchObject({ success: false, error: "Something broke" });
  });

  test("returns custom statusCode if error has statusCode property", () => {
    const { statusCode, body } = invokeHandler({ statusCode: 404, message: "Not found" });
    expect(statusCode).toBe(404);
    expect(body).toMatchObject({ success: false, error: "Not found" });
  });

  test("returns custom status if error has status property", () => {
    const { statusCode } = invokeHandler({ status: 422, message: "Unprocessable" });
    expect(statusCode).toBe(422);
  });

  test("defaults to 500 for unknown error shapes", () => {
    const { statusCode, body } = invokeHandler("unexpected string error");
    expect(statusCode).toBe(500);
    expect(body).toMatchObject({ success: false, error: "Internal server error" });
  });

  test("defaults to 500 when statusCode is out of the 4xx–5xx range", () => {
    const { statusCode } = invokeHandler({ statusCode: 200, message: "OK" });
    expect(statusCode).toBe(500);
  });

  test("returns 500 for null error (boundary)", () => {
    const { statusCode, body } = invokeHandler(null);
    expect(statusCode).toBe(500);
    expect(body).toMatchObject({ success: false, error: "Internal server error" });
  });

  test("handles error object without message gracefully (boundary)", () => {
    const { body } = invokeHandler({ statusCode: 500 });
    expect(body).toMatchObject({ success: false, error: "Internal server error" });
  });

  test("includes stack in development mode", () => {
    const error = new Error("dev error");
    const { body } = invokeHandler(error, "development");
    expect(body).toHaveProperty("stack");
    expect(typeof body["stack"]).toBe("string");
  });

  test("excludes stack in production mode", () => {
    const error = new Error("prod error");
    const { body } = invokeHandler(error, "production");
    expect(body).not.toHaveProperty("stack");
  });

  test("returns a function with 4 parameters (ErrorRequestHandler signature)", () => {
    const handler = createErrorHandler("production");
    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(4);
  });
});
