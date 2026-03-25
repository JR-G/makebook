import { describe, test, expect, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import type { Pool, QueryResult } from "pg";
import jwt from "jsonwebtoken";
import type { Agent, User } from "@makebook/types";
import { generateApiKey } from "@makebook/auth";
import { authenticateAgent, optionalAgent, authenticateUser } from "./auth.ts";

const TEST_JWT_SECRET = "test-secret-that-is-long-enough";

function makeAgentPool(rows: Agent[]): Pool {
  return {
    query: mock(() =>
      Promise.resolve({ rows } as QueryResult<Agent>),
    ),
  } as unknown as Pool;
}

function makeFailingPool(error: Error): Pool {
  return {
    query: mock(() => Promise.reject(error)),
  } as unknown as Pool;
}

function makeUserPool(rows: User[]): Pool {
  return {
    query: mock(() =>
      Promise.resolve({ rows } as QueryResult<User>),
    ),
  } as unknown as Pool;
}

function makeRequest(
  authHeader: string | undefined,
  pool: Pool,
  jwtSecret = TEST_JWT_SECRET,
): Request {
  return {
    headers: { authorization: authHeader },
    app: {
      locals: {
        pool,
        config: { jwtSecret },
      },
    },
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

const activeAgent: Agent = {
  id: "agent-1",
  name: "Test Agent",
  api_key_hash: "abc123hash",
  status: "active",
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
};

const activeUser: User = {
  id: "user-uuid-1",
  github_id: 12345,
  username: "testuser",
  email: "test@example.com",
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
};

describe("authenticateAgent", () => {
  test("returns 401 when no Authorization header present", async () => {
    const pool = makeAgentPool([]);
    const request = makeRequest(undefined, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateAgent()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toMatchObject({ success: false });
  });

  test("returns 401 when Authorization header has invalid format (Basic)", async () => {
    const pool = makeAgentPool([]);
    const request = makeRequest("Basic dXNlcjpwYXNz", pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateAgent()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns 401 when token is Bearer but not API key format", async () => {
    const pool = makeAgentPool([]);
    const request = makeRequest("Bearer not-an-api-key", pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateAgent()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns 401 when API key is valid format but not found in database", async () => {
    const pool = makeAgentPool([]);
    const { key } = generateApiKey();
    const request = makeRequest(`Bearer ${key}`, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateAgent()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toEqual({ success: false, error: "Invalid API key" });
  });

  test("returns 401 when agent exists but status is not active (suspended)", async () => {
    const { key } = generateApiKey();
    // The SQL query filters status = 'active', so a suspended agent returns no rows
    const emptyPool = makeAgentPool([]);
    const request = makeRequest(`Bearer ${key}`, emptyPool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateAgent()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("sets req.agent and calls next() when valid key matches active agent", async () => {
    const pool = makeAgentPool([activeAgent]);
    const { key } = generateApiKey();
    const request = makeRequest(`Bearer ${key}`, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateAgent()(request, response, next);

    expect(nextCalled).toBe(true);
    expect(request.agent).toEqual(activeAgent);
    expect(state.statusCode).toBeUndefined();
  });

  test("uses hashApiKey to hash before database lookup (does not pass raw key)", async () => {
    let capturedParam = "";
    const pool = {
      query: mock((_sql: string, params: string[]) => {
        capturedParam = params[0] ?? "";
        return Promise.resolve({ rows: [] } as unknown as QueryResult);
      }),
    } as unknown as Pool;

    const { key } = generateApiKey();
    const request = makeRequest(`Bearer ${key}`, pool);
    const { response } = makeResponse();

    await authenticateAgent()(request, response, () => {});

    expect(capturedParam).not.toBe(key);
    expect(capturedParam).toHaveLength(64);
  });

  test("calls next(error) when database query throws", async () => {
    const dbError = new Error("connection refused");
    const pool = makeFailingPool(dbError);
    const { key } = generateApiKey();
    const request = makeRequest(`Bearer ${key}`, pool);
    const { response } = makeResponse();
    let receivedError: unknown;
    const next: NextFunction = (error) => {
      receivedError = error;
    };

    await authenticateAgent()(request, response, next);

    expect(receivedError).toBe(dbError);
  });
});

describe("optionalAgent", () => {
  test("calls next() with no req.agent when no Authorization header present", async () => {
    const pool = makeAgentPool([]);
    const request = makeRequest(undefined, pool);
    const { response } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await optionalAgent()(request, response, next);

    expect(nextCalled).toBe(true);
    expect(request.agent).toBeUndefined();
  });

  test("returns 401 when key is present but not valid API key format", async () => {
    const pool = makeAgentPool([]);
    const request = makeRequest("Bearer not-an-api-key", pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await optionalAgent()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns 401 when valid format API key is not found in database", async () => {
    const pool = makeAgentPool([]);
    const { key } = generateApiKey();
    const request = makeRequest(`Bearer ${key}`, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await optionalAgent()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("sets req.agent and calls next() when valid key is provided", async () => {
    const pool = makeAgentPool([activeAgent]);
    const { key } = generateApiKey();
    const request = makeRequest(`Bearer ${key}`, pool);
    const { response } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await optionalAgent()(request, response, next);

    expect(nextCalled).toBe(true);
    expect(request.agent).toEqual(activeAgent);
  });
});

describe("authenticateUser", () => {
  test("returns 401 when no Authorization header present", async () => {
    const pool = makeUserPool([]);
    const request = makeRequest(undefined, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateUser()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.body).toMatchObject({ success: false });
  });

  test("returns 401 when JWT is expired", async () => {
    const expiredToken = jwt.sign(
      { userId: "user-1", username: "testuser" },
      TEST_JWT_SECRET,
      { expiresIn: -1 },
    );
    const pool = makeUserPool([]);
    const request = makeRequest(`Bearer ${expiredToken}`, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateUser()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns 401 when JWT signature is invalid", async () => {
    const tokenWithWrongSecret = jwt.sign(
      { userId: "user-1", username: "testuser" },
      "wrong-secret-entirely-different",
    );
    const pool = makeUserPool([]);
    const request = makeRequest(`Bearer ${tokenWithWrongSecret}`, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateUser()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns 401 when user ID in JWT does not exist in database", async () => {
    const token = jwt.sign(
      { userId: "nonexistent-user", username: "ghost" },
      TEST_JWT_SECRET,
    );
    const pool = makeUserPool([]);
    const request = makeRequest(`Bearer ${token}`, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateUser()(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("sets req.user and calls next() for valid JWT with matching user", async () => {
    const token = jwt.sign(
      { userId: activeUser.id, username: activeUser.username },
      TEST_JWT_SECRET,
    );
    const pool = makeUserPool([activeUser]);
    const request = makeRequest(`Bearer ${token}`, pool);
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    await authenticateUser()(request, response, next);

    expect(nextCalled).toBe(true);
    expect(request.user).toEqual(activeUser);
    expect(state.statusCode).toBeUndefined();
  });
});
