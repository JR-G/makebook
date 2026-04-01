import { describe, test, expect, mock } from "bun:test";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { AppConfig } from "./config/index.ts";
import type { InfraRouter } from "./services/infra-router.ts";
import { createApp } from "./app.ts";

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

function makeInfraRouter(): InfraRouter {
  return {
    decideBuildInfra: mock(() => Promise.resolve({ type: "shared" as const })),
    decideDeployInfra: mock(() => Promise.resolve({ type: "shared" as const })),
    recordUsage: mock(() => Promise.resolve()),
    getStatus: mock(() =>
      Promise.resolve({
        sandboxHoursUsedToday: 0,
        sandboxHoursLimitToday: 100,
        sandboxHoursRemaining: 100,
        activeSandboxes: 0,
        maxConcurrentSandboxes: 10,
        deployedApps: 0,
        maxDeployedApps: 20,
      }),
    ),
  } as unknown as InfraRouter;
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
  };
}

describe("createApp", () => {
  test("returns an Express application instance", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), config: makeConfig(), infraRouter: makeInfraRouter() });
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  test("has json parsing middleware configured", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), config: makeConfig(), infraRouter: makeInfraRouter() });
    expect(typeof app.get).toBe("function");
  });

  test("returns undefined for non-existent configuration", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), config: makeConfig(), infraRouter: makeInfraRouter() });
    expect(app.get("nonExistentSetting")).toBeUndefined();
  });

  test("returns distinct app instances for each call", () => {
    const appA = createApp({ pool: makePool(), redis: makeRedis(), config: makeConfig(), infraRouter: makeInfraRouter() });
    const appB = createApp({ pool: makePool(), redis: makeRedis(), config: makeConfig(), infraRouter: makeInfraRouter() });
    expect(appA).not.toBe(appB);
  });

  test("sets trust proxy so request.ip resolves behind a reverse proxy", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), config: makeConfig(), infraRouter: makeInfraRouter() });
    expect(app.get("trust proxy")).toBeTruthy();
  });
});
