import { describe, test, expect, mock } from "bun:test";
import type { Request, Response } from "express";
import type { Pool, QueryResult } from "pg";
import jwt from "jsonwebtoken";
import { hashApiKey, generateApiKey } from "@makebook/auth";
import type { Agent, User } from "@makebook/types";
import { authenticateAgent, optionalAgent, authenticateUser } from "./auth.ts";

const TEST_JWT_SECRET = "test-secret-that-is-long-enough";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-uuid-1",
    name: "Test Agent",
    api_key_hash: "some-hash",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-uuid-1",
    github_id: 12345,
    username: "testuser",
    email: "test@example.com",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePool(rows: Agent[] | User[]): Pool {
  return {
    query: mock(() =>
      Promise.resolve({ rows } as QueryResult<Agent | User>),
    ),
  } as unknown as Pool;
}

function makePoolThrowing(error: Error): Pool {
  return {
    query: mock(() => Promise.reject(error)),
  } as unknown as Pool;
}

function makeRequest(options: {
  authHeader?: string;
  pool?: Pool;
  jwtSecret?: string;
} = {}): Request {
  return {
    headers: { authorization: options.authHeader },
    app: {
      locals: {
        pool: options.pool ?? makePool([]),
        config: { jwtSecret: options.jwtSecret ?? TEST_JWT_SECRET },
      },
    },
    agent: undefined,
    user: undefined,
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
      return response;
    },
  } as unknown as Response;

  return { response, state };
}

describe("authenticateAgent", () => {
  test("returns 401 when no Authorization header present", async () => {
    const { response, state } = makeResponse();
    let nextCalled = false;
    await authenticateAgent()(
      makeRequest(),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toMatchObject({ success: false });
  });

  test("returns 401 when Authorization header has invalid format", async () => {
    const { response, state } = makeResponse();
    let nextCalled = false;
    await authenticateAgent()(
      makeRequest({ authHeader: "Basic dXNlcjpwYXNz" }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns 401 when API key is valid format but not found in database", async () => {
    const { key } = generateApiKey();
    const { response, state } = makeResponse();
    let nextCalled = false;
    await authenticateAgent()(
      makeRequest({ authHeader: `Bearer ${key}`, pool: makePool([]) }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toMatchObject({ success: false, error: "Invalid API key" });
  });

  test("returns 401 when agent status is not active (filtered by SQL query)", async () => {
    const { key } = generateApiKey();
    const { response, state } = makeResponse();
    let nextCalled = false;

    await authenticateAgent()(
      makeRequest({ authHeader: `Bearer ${key}`, pool: makePool([]) }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("sets req.agent and calls next() when valid key matches active agent", async () => {
    const { key } = generateApiKey();
    const agent = makeAgent({ api_key_hash: hashApiKey(key) });
    const { response } = makeResponse();
    let nextCalled = false;
    const request = makeRequest({
      authHeader: `Bearer ${key}`,
      pool: makePool([agent]),
    });

    await authenticateAgent()(request, response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(request.agent).toEqual(agent);
  });

  test("uses hashApiKey to hash before database lookup (does not expose raw key)", async () => {
    const { key } = generateApiKey();
    let capturedParam = "";
    const pool = {
      query: mock((_sql: string, params: string[]) => {
        capturedParam = params[0] ?? "";
        return Promise.resolve({ rows: [] } as unknown as QueryResult<Agent>);
      }),
    } as unknown as Pool;

    const { response } = makeResponse();
    await authenticateAgent()(
      makeRequest({ authHeader: `Bearer ${key}`, pool }),
      response,
      () => {},
    );

    expect(capturedParam).not.toBe(key);
    expect(capturedParam).toBe(hashApiKey(key));
    expect(capturedParam).toHaveLength(64);
  });

  test("calls next(error) when the database query throws", async () => {
    const { key } = generateApiKey();
    const dbError = new Error("connection refused");
    const { response } = makeResponse();
    let receivedError: unknown;

    await authenticateAgent()(
      makeRequest({ authHeader: `Bearer ${key}`, pool: makePoolThrowing(dbError) }),
      response,
      (error) => { receivedError = error; },
    );

    expect(receivedError).toBe(dbError);
  });
});

describe("optionalAgent", () => {
  test("calls next() with no req.agent when no Authorization header present", async () => {
    const { response } = makeResponse();
    let nextCalled = false;
    const request = makeRequest();

    await optionalAgent()(request, response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(request.agent).toBeUndefined();
  });

  test("returns 401 when key is present but not found in database", async () => {
    const { key } = generateApiKey();
    const { response, state } = makeResponse();
    let nextCalled = false;

    await optionalAgent()(
      makeRequest({ authHeader: `Bearer ${key}`, pool: makePool([]) }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns 401 when Authorization header is present but malformed", async () => {
    const { response, state } = makeResponse();
    let nextCalled = false;

    await optionalAgent()(
      makeRequest({ authHeader: "Bearer not-a-valid-mk-key" }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("sets req.agent when valid key provided", async () => {
    const { key } = generateApiKey();
    const agent = makeAgent({ api_key_hash: hashApiKey(key) });
    const { response } = makeResponse();
    let nextCalled = false;
    const request = makeRequest({
      authHeader: `Bearer ${key}`,
      pool: makePool([agent]),
    });

    await optionalAgent()(request, response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(request.agent).toEqual(agent);
  });
});

describe("authenticateUser", () => {
  test("returns 401 when no Authorization header present", async () => {
    const { response, state } = makeResponse();
    let nextCalled = false;

    await authenticateUser()(makeRequest(), response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toMatchObject({ success: false });
  });

  test("returns 401 when JWT is expired", async () => {
    const expiredToken = jwt.sign(
      { userId: "user-uuid-1", username: "testuser" },
      TEST_JWT_SECRET,
      { expiresIn: -1 },
    );
    const { response, state } = makeResponse();
    let nextCalled = false;

    await authenticateUser()(
      makeRequest({ authHeader: `Bearer ${expiredToken}` }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toMatchObject({ success: false, error: "Invalid or expired token" });
  });

  test("returns 401 when JWT signature is invalid", async () => {
    const badToken = jwt.sign(
      { userId: "user-uuid-1", username: "testuser" },
      "wrong-secret-that-is-at-least-16-chars",
      { expiresIn: "7d" },
    );
    const { response, state } = makeResponse();
    let nextCalled = false;

    await authenticateUser()(
      makeRequest({ authHeader: `Bearer ${badToken}` }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toMatchObject({ success: false, error: "Invalid or expired token" });
  });

  test("returns 401 when user ID in JWT does not exist in database", async () => {
    const token = jwt.sign(
      { userId: "nonexistent-user", username: "ghost" },
      TEST_JWT_SECRET,
      { expiresIn: "7d" },
    );
    const { response, state } = makeResponse();
    let nextCalled = false;

    await authenticateUser()(
      makeRequest({ authHeader: `Bearer ${token}`, pool: makePool([]) }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("sets req.user and calls next() for valid JWT with existing user", async () => {
    const user = makeUser();
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      TEST_JWT_SECRET,
      { expiresIn: "7d" },
    );
    const { response } = makeResponse();
    let nextCalled = false;
    const request = makeRequest({
      authHeader: `Bearer ${token}`,
      pool: makePool([user]),
    });

    await authenticateUser()(request, response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
    expect(request.user).toEqual(user);
  });

  test("returns 401 for a non-JWT bearer token (e.g. an API key)", async () => {
    const { key } = generateApiKey();
    const { response, state } = makeResponse();
    let nextCalled = false;

    await authenticateUser()(
      makeRequest({ authHeader: `Bearer ${key}` }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });
});
