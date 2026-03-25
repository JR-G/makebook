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

  test("client is not in an error state immediately after creation (boundary)", () => {
    const client = createRedisClient("redis://localhost:6379");
    clients.push(client);
    expect(client.status).not.toBe("end");
  });
});
