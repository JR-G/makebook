import { describe, test, expect, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import type { Pool, QueryResult } from "pg";
import { authenticateAgent } from "./auth.ts";

function makePool(rows: { id: string; name: string }[]): Pool {
  return {
    query: mock(() =>
      Promise.resolve({ rows } as QueryResult<{ id: string; name: string }>),
    ),
  } as unknown as Pool;
}

function makeRequest(authHeader?: string): Request {
  return {
    headers: { authorization: authHeader },
    agent: undefined,
  } as unknown as Request;
}

function makeResponse(): {
  response: Response;
  state: { statusCode: number | undefined; body: unknown };
} {
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

  return { response, state };
}

describe("authenticateAgent", () => {
  test("calls next() and sets request.agent when token is valid", async () => {
    const pool = makePool([{ id: "agent-1", name: "Test Agent" }]);
    const request = makeRequest(`Bearer makebook_${"a".repeat(64)}`);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    const handler = authenticateAgent(pool);
    await handler(request, response, next);

    expect(nextCalled).toBe(true);
    expect(request.agent).toEqual({ id: "agent-1", name: "Test Agent" });
    expect(state.statusCode).toBeUndefined();
  });

  test("responds 401 when Authorization header is missing", async () => {
    const pool = makePool([]);
    const request = makeRequest(undefined);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await authenticateAgent(pool)(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("responds 401 when Authorization header is not a Bearer token", async () => {
    const pool = makePool([]);
    const request = makeRequest("Basic dXNlcjpwYXNz");
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await authenticateAgent(pool)(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("responds 401 when API key is not found in the database", async () => {
    const pool = makePool([]);
    const request = makeRequest(`Bearer makebook_${"b".repeat(64)}`);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await authenticateAgent(pool)(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ error: "Invalid API key" });
  });

  test("calls next(error) when the database query throws", async () => {
    const dbError = new Error("connection refused");
    const pool = {
      query: mock(() => Promise.reject(dbError)),
    } as unknown as Pool;

    const request = makeRequest(`Bearer makebook_${"a".repeat(64)}`);
    const { response } = makeResponse();
    let receivedError: unknown;
    const next: NextFunction = (error) => { receivedError = error; };

    await authenticateAgent(pool)(request, response, next);

    expect(receivedError).toBe(dbError);
  });

  test("hashes the token before querying (does not expose raw key)", async () => {
    let capturedHash = "";
    const pool = {
      query: mock((_sql: string, params: string[]) => {
        capturedHash = params[0] ?? "";
        return Promise.resolve({ rows: [] } as unknown as QueryResult);
      }),
    } as unknown as Pool;

    const rawKey = `makebook_${"c".repeat(64)}`;
    const request = makeRequest(`Bearer ${rawKey}`);
    const { response } = makeResponse();
    await authenticateAgent(pool)(request, response, () => {});

    expect(capturedHash).not.toBe(rawKey);
    expect(capturedHash).toHaveLength(64);
  });
});
