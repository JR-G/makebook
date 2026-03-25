import { describe, test, expect, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import type { Pool, QueryResult } from "pg";
import jwt from "jsonwebtoken";
import type { User } from "@makebook/types";
import type { AppConfig } from "../config/index.ts";

const TEST_JWT_SECRET = "test-secret-that-is-long-enough";

const TEST_CONFIG: AppConfig = {
  port: 3000,
  nodeEnv: "test",
  databaseUrl: "postgresql://localhost/test",
  redisUrl: "redis://localhost:6379",
  giteaUrl: "http://localhost:3001",
  giteaAdminToken: "test-admin-token",
  jwtSecret: TEST_JWT_SECRET,
  githubClientId: "test-client-id",
  githubClientSecret: "test-client-secret",
  githubCallbackUrl: "http://localhost:3000/auth/github/callback",
};

const TEST_USER: User = {
  id: "user-uuid-1",
  github_id: 12345,
  username: "octocat",
  email: "octocat@github.com",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makePool(rows: User[]): Pool {
  return {
    query: mock(() =>
      Promise.resolve({ rows } as QueryResult<User>),
    ),
  } as unknown as Pool;
}

function makeRequest(options: {
  query?: Record<string, string>;
  authHeader?: string;
  pool?: Pool;
  config?: AppConfig;
  user?: User;
  cookies?: Record<string, string>;
} = {}): Request {
  return {
    headers: { authorization: options.authHeader },
    query: options.query ?? {},
    cookies: options.cookies ?? {},
    app: {
      locals: {
        pool: options.pool ?? makePool([]),
        config: options.config ?? TEST_CONFIG,
      },
    },
    user: options.user,
  } as unknown as Request;
}

function makeResponse(): {
  response: Response;
  state: {
    statusCode: number | undefined;
    body: unknown;
    redirectUrl: string | undefined;
    cookies: Record<string, string>;
    clearedCookies: string[];
  };
} {
  const state: {
    statusCode: number | undefined;
    body: unknown;
    redirectUrl: string | undefined;
    cookies: Record<string, string>;
    clearedCookies: string[];
  } = {
    statusCode: undefined,
    body: undefined,
    redirectUrl: undefined,
    cookies: {},
    clearedCookies: [],
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
    redirect(url: string) {
      state.redirectUrl = url;
      return response;
    },
    cookie(name: string, value: string) {
      state.cookies[name] = value;
      return response;
    },
    clearCookie(name: string) {
      state.clearedCookies.push(name);
      return response;
    },
  } as unknown as Response;

  return { response, state };
}

describe("GET /auth/me", () => {
  test("returns 401 without valid JWT", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();
    let nextCalled = false;

    const meLayer = authRouter.stack.find(
      (layer) => layer.route?.path === "/me",
    );

    expect(meLayer).toBeDefined();

    const authMiddleware = meLayer!.route!.stack[0]!.handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;

    await authMiddleware(makeRequest(), response, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(401);
  });

  test("returns user data with valid JWT", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const token = jwt.sign(
      { userId: TEST_USER.id, username: TEST_USER.username },
      TEST_JWT_SECRET,
      { expiresIn: "7d" },
    );

    const pool = makePool([TEST_USER]);

    const meLayer = authRouter.stack.find(
      (layer) => layer.route?.path === "/me",
    );
    const authMiddleware = meLayer!.route!.stack[0]!.handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;
    const meHandler = meLayer!.route!.stack[1]!.handle as (
      req: Request,
      res: Response,
    ) => void;

    const request = makeRequest({
      authHeader: `Bearer ${token}`,
      pool,
    });

    let nextCalled = false;
    await authMiddleware(request, response, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);

    meHandler(request, response);

    expect(state.statusCode).toBe(200);
    const body = state.body as { success: boolean; data: User };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(TEST_USER);
  });
});
