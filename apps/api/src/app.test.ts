import { describe, test, expect, mock } from "bun:test";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { GiteaService } from "./services/gitea.ts";
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

function makeGitea(): GiteaService {
  return {
    createRepo: mock(() => Promise.resolve({ cloneUrl: "http://gitea/admin/test.git" })),
    listFiles: mock(() => Promise.resolve([])),
    getFile: mock(() => Promise.resolve(null)),
  } as unknown as GiteaService;
}

describe("createApp", () => {
  test("returns an Express application instance", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), gitea: makeGitea() });
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  test("has json parsing middleware configured", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), gitea: makeGitea() });
    expect(typeof app.get).toBe("function");
  });

  test("returns undefined for non-existent configuration", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), gitea: makeGitea() });
    expect(app.get("nonExistentSetting")).toBeUndefined();
  });

  test("returns distinct app instances for each call", () => {
    const appA = createApp({ pool: makePool(), redis: makeRedis(), gitea: makeGitea() });
    const appB = createApp({ pool: makePool(), redis: makeRedis(), gitea: makeGitea() });
    expect(appA).not.toBe(appB);
  });
});
