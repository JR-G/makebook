import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import type { Pool, QueryResult } from "pg";
import jwt from "jsonwebtoken";
import type { User } from "@makebook/types";
import type { AppConfig } from "../config/index.ts";

const TEST_JWT_SECRET = "test-secret-that-is-long-enough";
const TEST_OAUTH_STATE = "deadbeef01234567deadbeef01234567";

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

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchSequence(responses: { data: unknown; status?: number }[]): void {
  let callIndex = 0;
  globalThis.fetch = mock(async () => {
    const response = responses[callIndex];
    callIndex++;
    return new Response(JSON.stringify(response?.data ?? {}), {
      status: response?.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

describe("GET /auth/github", () => {
  test("redirects to GitHub OAuth URL with correct client_id and scope", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const layers = authRouter.stack;
    const githubLayer = layers.find(
      (layer) => layer.route?.path === "/github",
    );

    expect(githubLayer).toBeDefined();

    const handler = githubLayer!.route!.stack[0]!.handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void;

    handler(makeRequest(), response, () => {});

    expect(state.redirectUrl).toBeDefined();
    const redirectUrl = new URL(state.redirectUrl!);
    expect(redirectUrl.hostname).toBe("github.com");
    expect(redirectUrl.pathname).toBe("/login/oauth/authorize");
    expect(redirectUrl.searchParams.get("client_id")).toBe(TEST_CONFIG.githubClientId);
    expect(redirectUrl.searchParams.get("scope")).toContain("read:user");
    expect(redirectUrl.searchParams.get("scope")).toContain("user:email");
  });

  test("includes a non-empty state parameter in the redirect URL", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const handler = authRouter.stack.find(
      (layer) => layer.route?.path === "/github",
    )!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => void;

    handler(makeRequest(), response, () => {});

    const redirectUrl = new URL(state.redirectUrl!);
    const stateParam = redirectUrl.searchParams.get("state");
    expect(typeof stateParam).toBe("string");
    expect((stateParam as string).length).toBeGreaterThan(0);
  });

  test("sets an oauth_state cookie matching the redirect state parameter", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const handler = authRouter.stack.find(
      (layer) => layer.route?.path === "/github",
    )!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => void;

    handler(makeRequest(), response, () => {});

    const redirectUrl = new URL(state.redirectUrl!);
    const stateParam = redirectUrl.searchParams.get("state");
    expect(state.cookies["oauth_state"]).toBe(stateParam);
  });
});

describe("GET /auth/github/callback", () => {
  test("returns 400 when code parameter is missing", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();
    let nextCalled = false;

    const layer = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    );
    const handler = layer!.route!.stack[0]!.handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;

    await handler(
      makeRequest({ query: { state: TEST_OAUTH_STATE }, cookies: { oauth_state: TEST_OAUTH_STATE } }),
      response,
      () => { nextCalled = true; },
    );

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ success: false, error: "Missing code parameter" });
  });

  test("returns 400 when state parameter is missing", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const handler = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    )!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>;

    await handler(
      makeRequest({ query: { code: "some-code" }, cookies: { oauth_state: TEST_OAUTH_STATE } }),
      response,
      () => {},
    );

    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ success: false, error: "Invalid or missing OAuth state" });
  });

  test("returns 400 when state does not match the cookie", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const handler = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    )!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>;

    await handler(
      makeRequest({
        query: { code: "some-code", state: "wrong-state" },
        cookies: { oauth_state: TEST_OAUTH_STATE },
      }),
      response,
      () => {},
    );

    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ success: false, error: "Invalid or missing OAuth state" });
  });

  test("returns 400 when oauth_state cookie is absent", async () => {
    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const handler = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    )!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>;

    await handler(
      makeRequest({ query: { code: "some-code", state: TEST_OAUTH_STATE } }),
      response,
      () => {},
    );

    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ success: false, error: "Invalid or missing OAuth state" });
  });

  test("returns 400 when GitHub token exchange returns an error", async () => {
    mockFetchSequence([
      { data: { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } },
    ]);

    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const handler = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    )!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>;

    await handler(
      makeRequest({
        query: { code: "bad-code", state: TEST_OAUTH_STATE },
        cookies: { oauth_state: TEST_OAUTH_STATE },
      }),
      response,
      (err) => { throw err as Error; },
    );

    expect(state.statusCode).toBe(400);
    expect(state.body).toMatchObject({ success: false });
  });

  test("returns 200 with JWT token and user data on successful OAuth flow", async () => {
    mockFetchSequence([
      { data: { access_token: "gha_test_token" } },
      { data: { id: 12345, login: "octocat" } },
      {
        data: [
          { email: "octocat@github.com", primary: true, verified: true },
        ],
      },
    ]);

    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const pool: Pool = {
      query: mock(() =>
        Promise.resolve({ rows: [TEST_USER] } as QueryResult<User>),
      ),
    } as unknown as Pool;

    const layer = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    );
    const handler = layer!.route!.stack[0]!.handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;

    await handler(
      makeRequest({
        query: { code: "github-oauth-code", state: TEST_OAUTH_STATE },
        cookies: { oauth_state: TEST_OAUTH_STATE },
        pool,
      }),
      response,
      (err) => { throw err as Error; },
    );

    expect(state.statusCode).toBe(200);
    const body = state.body as {
      success: boolean;
      data: { token: string; user: { id: string; username: string; email: string } };
    };
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe("string");
    expect(body.data.user.username).toBe(TEST_USER.username);
    expect(body.data.user.email).toBe(TEST_USER.email);

    const decoded = jwt.verify(body.data.token, TEST_JWT_SECRET) as {
      userId: string;
      username: string;
    };
    expect(decoded.userId).toBe(TEST_USER.id);
    expect(decoded.username).toBe(TEST_USER.username);
  });

  test("clears the oauth_state cookie after successful state verification", async () => {
    mockFetchSequence([
      { data: { access_token: "gha_test_token" } },
      { data: { id: 12345, login: "octocat" } },
      { data: [{ email: "octocat@github.com", primary: true, verified: true }] },
    ]);

    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const pool: Pool = {
      query: mock(() =>
        Promise.resolve({ rows: [TEST_USER] } as QueryResult<User>),
      ),
    } as unknown as Pool;

    const handler = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    )!.route!.stack[0]!.handle as (req: Request, res: Response, next: NextFunction) => Promise<void>;

    await handler(
      makeRequest({
        query: { code: "github-oauth-code", state: TEST_OAUTH_STATE },
        cookies: { oauth_state: TEST_OAUTH_STATE },
        pool,
      }),
      response,
      (err) => { throw err as Error; },
    );

    expect(state.clearedCookies).toContain("oauth_state");
  });

  test("upserts user on first login (creates new record)", async () => {
    const newUser: User = {
      ...TEST_USER,
      id: "new-user-uuid",
      username: "newuser",
      email: "new@example.com",
      github_id: 99999,
    };

    mockFetchSequence([
      { data: { access_token: "gha_new_token" } },
      { data: { id: 99999, login: "newuser" } },
      { data: [{ email: "new@example.com", primary: true, verified: true }] },
    ]);

    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const pool: Pool = {
      query: mock(() =>
        Promise.resolve({ rows: [newUser] } as QueryResult<User>),
      ),
    } as unknown as Pool;

    const layer = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    );
    const handler = layer!.route!.stack[0]!.handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;

    await handler(
      makeRequest({
        query: { code: "new-user-code", state: TEST_OAUTH_STATE },
        cookies: { oauth_state: TEST_OAUTH_STATE },
        pool,
      }),
      response,
      (err) => { throw err as Error; },
    );

    expect(state.statusCode).toBe(200);
    const body = state.body as { data: { user: { username: string } } };
    expect(body.data.user.username).toBe("newuser");
  });

  test("updates existing user on subsequent login (upsert)", async () => {
    const updatedUser: User = {
      ...TEST_USER,
      username: "octocat-updated",
      email: "updated@github.com",
    };

    mockFetchSequence([
      { data: { access_token: "gha_updated_token" } },
      { data: { id: 12345, login: "octocat-updated" } },
      { data: [{ email: "updated@github.com", primary: true, verified: true }] },
    ]);

    const { authRouter } = await import("./auth.ts");
    const { response, state } = makeResponse();

    const pool: Pool = {
      query: mock(() =>
        Promise.resolve({ rows: [updatedUser] } as QueryResult<User>),
      ),
    } as unknown as Pool;

    const layer = authRouter.stack.find(
      (routeLayer) => routeLayer.route?.path === "/github/callback",
    );
    const handler = layer!.route!.stack[0]!.handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;

    await handler(
      makeRequest({
        query: { code: "returning-user-code", state: TEST_OAUTH_STATE },
        cookies: { oauth_state: TEST_OAUTH_STATE },
        pool,
      }),
      response,
      (err) => { throw err as Error; },
    );

    expect(state.statusCode).toBe(200);
    const body = state.body as { data: { user: { email: string } } };
    expect(body.data.user.email).toBe("updated@github.com");
  });
});

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
