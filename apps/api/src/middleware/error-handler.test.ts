import { describe, test, expect } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "./error-handler.ts";

function invokeHandler(
  error: unknown,
): { statusCode: number | undefined; body: unknown } {
  const state: { statusCode: number | undefined; body: unknown } = {
    statusCode: undefined,
    body: undefined,
  };

  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(data: unknown) {
      state.body = data;
    },
  } as unknown as Response;

  const handler = errorHandler();
  handler(
    error,
    {} as Request,
    response,
    (() => {}) as unknown as NextFunction,
  );

  return state;
}

describe("errorHandler", () => {
  test("returns 500 for a plain Error", () => {
    const { statusCode, body } = invokeHandler(new Error("Something broke"));
    expect(statusCode).toBe(500);
    expect(body).toEqual({ error: "Something broke" });
  });

  test("returns statusCode from HttpError object", () => {
    const { statusCode, body } = invokeHandler({
      statusCode: 404,
      message: "Not found",
    });
    expect(statusCode).toBe(404);
    expect(body).toEqual({ error: "Not found" });
  });

  test("returns 400 for a 400 HttpError", () => {
    const { statusCode } = invokeHandler({
      statusCode: 400,
      message: "Bad request",
    });
    expect(statusCode).toBe(400);
  });

  test("defaults to 500 for unknown error shapes", () => {
    const { statusCode, body } = invokeHandler("unexpected string error");
    expect(statusCode).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
  });

  test("defaults to 500 when statusCode is out of range", () => {
    const { statusCode } = invokeHandler({ statusCode: 200, message: "OK" });
    expect(statusCode).toBe(500);
  });

  test("returns 500 for null error", () => {
    const { statusCode, body } = invokeHandler(null);
    expect(statusCode).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
  });

  test("returns the function (is a factory)", () => {
    const handler = errorHandler();
    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(4);
  });

  test("returns response with error key in JSON body", () => {
    const { body } = invokeHandler(new Error("oops"));
    expect(body).toHaveProperty("error");
  });

  test("handles error object without message gracefully", () => {
    const { body } = invokeHandler({ statusCode: 500 });
    expect(body).toEqual({ error: "Internal server error" });
  });
});
