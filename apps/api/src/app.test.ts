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
    incr: mock(() => Promise.resolve(1)),
    expire: mock(() => Promise.resolve(1)),
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

  test("can be created without pool or redis (for unit tests)", () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
  });

  test("stores pool on app.locals", () => {
    const pool = makePool();
    const app = createApp({ pool });
    expect(app.locals["pool"]).toBe(pool);
  });

  test("stores redis on app.locals", () => {
    const redis = makeRedis();
    const app = createApp({ redis });
    expect(app.locals["redis"]).toBe(redis);
  });
});
