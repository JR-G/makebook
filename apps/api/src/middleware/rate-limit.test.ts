import { describe, test, expect, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";
import { createRateLimiter } from "./rate-limit.ts";

function makeRedis(incrResult: number): Redis {
  return {
    incr: mock(() => Promise.resolve(incrResult)),
    expire: mock(() => Promise.resolve(1)),
  } as unknown as Redis;
}

function makeRequest(agentId?: string, ip = "127.0.0.1"): Request {
  return {
    ip,
    agent: agentId ? { id: agentId, name: "Test Agent" } : undefined,
  } as unknown as Request;
}

function makeResponse(): {
  response: Response;
  state: {
    statusCode: number | undefined;
    body: unknown;
    headers: Record<string, string>;
  };
} {
  const state: {
    statusCode: number | undefined;
    body: unknown;
    headers: Record<string, string>;
  } = {
    statusCode: undefined,
    body: undefined,
    headers: {},
  };

  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    set(name: string, value: string) {
      state.headers[name] = value;
      return response;
    },
    json(data: unknown) {
      state.body = data;
    },
  } as unknown as Response;

  return { response, state };
}

describe("createRateLimiter", () => {
  test("calls next() when request is within the limit", async () => {
    const redis = makeRedis(1);
    const request = makeRequest("agent-1");
    const { response } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await createRateLimiter(redis)(request, response, next);

    expect(nextCalled).toBe(true);
  });

  test("responds 429 with { success: false, error } when limit is exceeded", async () => {
    const redis = makeRedis(101);
    const request = makeRequest("agent-1");
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await createRateLimiter(redis)(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(429);
    expect(state.body).toMatchObject({ success: false, error: "Rate limit exceeded" });
  });

  test("sets X-RateLimit-Limit header when within limit", async () => {
    const redis = makeRedis(5);
    const request = makeRequest("agent-1");
    const { response, state } = makeResponse();

    await createRateLimiter(redis, { maxRequests: 50 })(request, response, () => {});

    expect(state.headers["X-RateLimit-Limit"]).toBe("50");
  });

  test("sets X-RateLimit-Remaining header when within limit", async () => {
    const redis = makeRedis(10);
    const request = makeRequest("agent-1");
    const { response, state } = makeResponse();

    await createRateLimiter(redis, { maxRequests: 100 })(request, response, () => {});

    expect(state.headers["X-RateLimit-Remaining"]).toBe("90");
  });

  test("sets X-RateLimit-Reset header when within limit", async () => {
    const redis = makeRedis(1);
    const request = makeRequest("agent-1");
    const { response, state } = makeResponse();

    await createRateLimiter(redis, { windowSeconds: 60 })(request, response, () => {});

    expect(state.headers["X-RateLimit-Reset"]).toBeDefined();
    expect(Number(state.headers["X-RateLimit-Reset"])).toBeGreaterThan(0);
  });

  test("uses correct Redis key format: ratelimit:<identifier>:<windowBucket>", async () => {
    let capturedKey = "";
    const redis = {
      incr: mock((key: string) => {
        capturedKey = key;
        return Promise.resolve(1);
      }),
      expire: mock(() => Promise.resolve(1)),
    } as unknown as Redis;

    const request = makeRequest("my-agent-id");
    const { response } = makeResponse();
    await createRateLimiter(redis, { windowSeconds: 60 })(request, response, () => {});

    const expectedBucket = Math.floor(Date.now() / 1000 / 60);
    expect(capturedKey).toBe(`ratelimit:my-agent-id:${expectedBucket}`);
  });

  test("uses IP address as identifier when no agent is set", async () => {
    let capturedKey = "";
    const redis = {
      incr: mock((key: string) => {
        capturedKey = key;
        return Promise.resolve(1);
      }),
      expire: mock(() => Promise.resolve(1)),
    } as unknown as Redis;

    const request = makeRequest(undefined, "10.0.0.1");
    const { response } = makeResponse();
    await createRateLimiter(redis, { windowSeconds: 60 })(request, response, () => {});

    const expectedBucket = Math.floor(Date.now() / 1000 / 60);
    expect(capturedKey).toBe(`ratelimit:10.0.0.1:${expectedBucket}`);
  });

  test("handles Redis error gracefully by calling next() without error", async () => {
    const redis = {
      incr: mock(() => Promise.reject(new Error("Redis connection lost"))),
      expire: mock(() => Promise.resolve(1)),
    } as unknown as Redis;

    const request = makeRequest("agent-1");
    const { response } = makeResponse();
    let receivedError: unknown = "NOT_CALLED";
    const next: NextFunction = (error?: unknown) => { receivedError = error; };

    await createRateLimiter(redis)(request, response, next);

    expect(receivedError).toBeUndefined();
  });

  test("sets expire on new key (count === 1)", async () => {
    let expireCalled = false;
    const redis = {
      incr: mock(() => Promise.resolve(1)),
      expire: mock(() => {
        expireCalled = true;
        return Promise.resolve(1);
      }),
    } as unknown as Redis;

    const request = makeRequest("agent-1");
    const { response } = makeResponse();
    await createRateLimiter(redis)(request, response, () => {});

    expect(expireCalled).toBe(true);
  });

  test("does not set expire for subsequent requests (count > 1)", async () => {
    let expireCalled = false;
    const redis = {
      incr: mock(() => Promise.resolve(5)),
      expire: mock(() => {
        expireCalled = true;
        return Promise.resolve(1);
      }),
    } as unknown as Redis;

    const request = makeRequest("agent-1");
    const { response } = makeResponse();
    await createRateLimiter(redis)(request, response, () => {});

    expect(expireCalled).toBe(false);
  });
});
