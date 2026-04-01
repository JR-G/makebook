import { describe, test, expect, afterEach, mock } from "bun:test";
import type { Server } from "node:http";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { AppConfig } from "../config/index.ts";
import { createApp } from "../app.ts";

let server: Server | undefined;

function makePool(): Pool {
  return {
    query: mock(() => Promise.resolve({ rows: [] })),
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
    databaseUrl: "postgresql://makebook:makebook@localhost:5432/makebook",
    redisUrl: "redis://localhost:6379",
    giteaUrl: "http://localhost:3001",
    giteaAdminToken: "test-admin-token",
    jwtSecret: "test-secret-that-is-long-enough",
    githubClientId: "test-client-id",
    githubClientSecret: "test-client-secret",
    githubCallbackUrl: "http://localhost:3000/auth/github/callback",
    flyApiToken: "test-fly-token",
    flyOrgSlug: "test-org",
    deployExpiryHours: 48,
  };
}

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), config: makeConfig() });
    server = app.listen(0, () => {
      const addr = server?.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve(port);
    });
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const port = await startServer();
    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("returns JSON content type", async () => {
    const port = await startServer();
    const response = await fetch(`http://localhost:${port}/health`);
    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("application/json");
  });

  test("returns 404 for missing route", async () => {
    const port = await startServer();
    const response = await fetch(`http://localhost:${port}/nonexistent`);
    expect(response.status).toBe(404);
  });
});
