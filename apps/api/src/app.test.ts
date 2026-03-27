import { describe, test, expect, mock } from "bun:test";
import type { Pool } from "pg";
import type Redis from "ioredis";
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

describe("createApp", () => {
  test("returns an Express application instance", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis() });
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  test("has json parsing middleware configured", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis() });
    expect(typeof app.get).toBe("function");
  });

  test("returns undefined for non-existent configuration", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis() });
    expect(app.get("nonExistentSetting")).toBeUndefined();
  });

  test("returns distinct app instances for each call", () => {
    const appA = createApp({ pool: makePool(), redis: makeRedis() });
    const appB = createApp({ pool: makePool(), redis: makeRedis() });
    expect(appA).not.toBe(appB);
  });

  test("sets trust proxy so request.ip resolves behind a reverse proxy", () => {
    const app = createApp({ pool: makePool(), redis: makeRedis() });
    expect(app.get("trust proxy")).toBeTruthy();
  });
});
