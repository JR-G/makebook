import { describe, test, expect, afterEach } from "bun:test";
import Redis from "ioredis";
import { createRedisClient } from "./redis.ts";

describe("createRedisClient", () => {
  const clients: Redis[] = [];

  afterEach(() => {
    for (const client of clients) {
      client.disconnect();
    }
    clients.length = 0;
  });

  test("returns a Redis instance", () => {
    const client = createRedisClient("redis://localhost:6379");
    clients.push(client);
    expect(client).toBeInstanceOf(Redis);
  });

  test("returned client has get and set methods", () => {
    const client = createRedisClient("redis://localhost:6379");
    clients.push(client);
    expect(typeof client.get).toBe("function");
    expect(typeof client.set).toBe("function");
  });

  test("returns distinct client instances for each call", () => {
    const clientA = createRedisClient("redis://localhost:6379");
    const clientB = createRedisClient("redis://localhost:6379");
    clients.push(clientA, clientB);
    expect(clientA).not.toBe(clientB);
  });

  test("does not connect immediately when lazyConnect is true", () => {
    const client = createRedisClient("redis://localhost:9999");
    clients.push(client);
    expect(client.status).toBe("wait");
  });

  test("configures defaults when optional settings are missing", () => {
    const client = createRedisClient("redis://localhost:6379");
    clients.push(client);
    expect(client.options.maxRetriesPerRequest).toBeNull();
    expect(client.options.enableReadyCheck).toBe(false);
  });

  test("logs redis errors to stderr", () => {
    const originalWrite = process.stderr.write;
    const writes: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const client = createRedisClient("redis://localhost:6379");
      clients.push(client);
      client.emit("error", new Error("connection lost"));
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(writes.join("")).toContain("connection lost");
  });

  test("logs redis connect events to stdout", () => {
    const originalWrite = process.stdout.write;
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const client = createRedisClient("redis://localhost:6379");
      clients.push(client);
      client.emit("connect");
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(writes.join("")).toContain("Redis connected");
  });
});
