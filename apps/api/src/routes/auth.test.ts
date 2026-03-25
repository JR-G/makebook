import { describe, test, expect, afterEach, mock } from "bun:test";
import type { Server } from "node:http";
import type { Pool, QueryResult } from "pg";
import type Redis from "ioredis";
import jwt from "jsonwebtoken";
import type { AppConfig } from "../config/index.ts";
import type { User } from "@makebook/types";
import { createApp } from "../app.ts";

const TEST_JWT_SECRET = "test-secret-that-is-long-enough";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

const testUser: User = {
  id: "user-uuid-1",
  github_id: 12345,
  username: "testuser",
  email: "test@example.com",
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
};

let server: Server | undefined;
const realFetch: typeof fetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  server?.close();
  server = undefined;
});

function makePool(rows: Partial<User>[] = []): Pool {
  return {
    query: mock(() =>
      Promise.resolve({ rows } as QueryResult<Partial<User>>),
    ),
    connect: mock(() => Promise.resolve({})),
    end: mock(() => Promise.resolve()),
  } as unknown as Pool;
}

function makeRedis(): Redis {
  return {
    eval: mock(() => Promise.resolve(1)),
    disconnect: mock(() => {}),
  } as unknown as Redis;
}

function makeConfig(): AppConfig {
  return {
    port: 3000,
    nodeEnv: "test",
    databaseUrl: "postgresql://localhost/test",
    redisUrl: "redis://localhost",
    giteaUrl: "http://localhost:3001",
    giteaAdminToken: "test-token",
    jwtSecret: TEST_JWT_SECRET,
    githubClientId: "test-github-client-id",
    githubClientSecret: "test-github-client-secret",
  };
}

function startServer(pool?: Pool): Promise<{ port: number }> {
  return new Promise((resolve) => {
    const app = createApp({
      pool: pool ?? makePool(),
      redis: makeRedis(),
      config: makeConfig(),
    });
    server = app.listen(0, () => {
      const addr = server?.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ port });
    });
  });
}

/**
 * Installs a mock for `globalThis.fetch` that intercepts GitHub API calls
 * by URL while passing all localhost requests through to the real fetch.
 */
function mockGitHubFetch(githubResponses: Record<string, unknown>): void {
  const captured = realFetch;
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url in githubResponses) {
      const body = JSON.stringify(githubResponses[url]);
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    return captured(input, init);
  }) as typeof fetch;
}

describe("GET /auth/github", () => {
  test("redirects to GitHub OAuth URL with correct client_id and scope", async () => {
    const { port } = await startServer();

    const response = await fetch(`http://localhost:${port}/auth/github`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("https://github.com/login/oauth/authorize");
    expect(location).toContain("client_id=test-github-client-id");
    expect(location).toContain("scope=read%3Auser%2Cuser%3Aemail");
  });
});

describe("GET /auth/github/callback", () => {
  test("returns 400 when code parameter is missing", async () => {
    const { port } = await startServer();

    const response = await fetch(
      `http://localhost:${port}/auth/github/callback`,
    );
    expect(response.status).toBe(400);

    const body = (await response.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("Missing code parameter");
  });

  test("returns 200 with JWT token and user data on successful OAuth flow", async () => {
    mockGitHubFetch({
      [GITHUB_TOKEN_URL]: { access_token: "gho_test_token" },
      [GITHUB_USER_URL]: { id: 12345, login: "testuser" },
      [GITHUB_EMAILS_URL]: [
        { email: "test@example.com", primary: true, verified: true },
      ],
    });

    const pool = makePool([testUser]);
    const { port } = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/auth/github/callback?code=test-oauth-code`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        token: string;
        user: { id: string; username: string; email: string };
      };
    };
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe("string");
    expect(body.data.user.username).toBe("testuser");
    expect(body.data.user.email).toBe("test@example.com");
  });

  test("creates new user on first login (upsert inserts)", async () => {
    const newUser: User = {
      ...testUser,
      id: "user-uuid-new",
      github_id: 99999,
      username: "newuser",
      email: "new@example.com",
    };

    mockGitHubFetch({
      [GITHUB_TOKEN_URL]: { access_token: "gho_new_token" },
      [GITHUB_USER_URL]: { id: 99999, login: "newuser" },
      [GITHUB_EMAILS_URL]: [
        { email: "new@example.com", primary: true, verified: true },
      ],
    });

    const pool = makePool([newUser]);
    const { port } = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/auth/github/callback?code=fresh-code`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { token: string; user: { username: string } };
    };
    expect(body.data.user.username).toBe("newuser");
  });

  test("updates existing user on subsequent login (upsert updates)", async () => {
    const updatedUser: User = { ...testUser, username: "renamed-user" };

    mockGitHubFetch({
      [GITHUB_TOKEN_URL]: { access_token: "gho_existing_token" },
      [GITHUB_USER_URL]: { id: testUser.github_id, login: "renamed-user" },
      [GITHUB_EMAILS_URL]: [
        { email: testUser.email, primary: true, verified: true },
      ],
    });

    const pool = makePool([updatedUser]);
    const { port } = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/auth/github/callback?code=returning-code`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { user: { username: string } };
    };
    expect(body.data.user.username).toBe("renamed-user");
  });
});

describe("GET /auth/me", () => {
  test("returns 401 without valid JWT", async () => {
    const { port } = await startServer();

    const response = await fetch(`http://localhost:${port}/auth/me`);
    expect(response.status).toBe(401);
  });

  test("returns user data with valid JWT", async () => {
    const token = jwt.sign(
      { userId: testUser.id, username: testUser.username },
      TEST_JWT_SECRET,
    );
    const pool = makePool([testUser]);
    const { port } = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { id: string; username: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(testUser.id);
    expect(body.data.username).toBe(testUser.username);
  });
});
