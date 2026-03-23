import { describe, test, expect, mock } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";
import { rateLimit } from "./rate-limit.ts";

function makeRedis(evalResult: number): Redis {
  return {
    eval: mock(() => Promise.resolve(evalResult)),
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
  state: { statusCode: number | undefined; body: unknown };
} {
  const state: { statusCode: number | undefined; body: unknown } = {
    statusCode: undefined,
    body: undefined,
  };

  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(data: unknown) {
      state.body = data;
    },
  } as unknown as Response;

  return { response, state };
}

describe("rateLimit", () => {
  test("calls next() when Redis allows the request", async () => {
    const redis = makeRedis(1);
    const request = makeRequest("agent-1");
    const { response } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await rateLimit(redis)(request, response, next);

    expect(nextCalled).toBe(true);
  });

  test("responds 429 when Redis denies the request", async () => {
    const redis = makeRedis(0);
    const request = makeRequest("agent-1");
    const { response, state } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await rateLimit(redis)(request, response, next);

    expect(nextCalled).toBe(false);
    expect(state.statusCode).toBe(429);
    expect(state.body).toEqual({ error: "Too many requests" });
  });

  test("uses agent ID as rate limit key when agent is set", async () => {
    let capturedKey = "";
    const redis = {
      eval: mock((_script: string, _numkeys: number, key: string) => {
        capturedKey = key;
        return Promise.resolve(1);
      }),
    } as unknown as Redis;

    const request = makeRequest("my-agent-id");
    const { response } = makeResponse();
    await rateLimit(redis)(request, response, () => {});

    expect(capturedKey).toBe("rate_limit:agent:my-agent-id");
  });

  test("falls back to IP address when no agent is set", async () => {
    let capturedKey = "";
    const redis = {
      eval: mock((_script: string, _numkeys: number, key: string) => {
        capturedKey = key;
        return Promise.resolve(1);
      }),
    } as unknown as Redis;

    const request = makeRequest(undefined, "10.0.0.1");
    const { response } = makeResponse();
    await rateLimit(redis)(request, response, () => {});

    expect(capturedKey).toBe("rate_limit:ip:10.0.0.1");
  });

  test("calls next(error) when Redis eval throws", async () => {
    const redisError = new Error("Redis connection lost");
    const redis = {
      eval: mock(() => Promise.reject(redisError)),
    } as unknown as Redis;

    const request = makeRequest("agent-1");
    const { response } = makeResponse();
    let receivedError: unknown;
    const next: NextFunction = (error) => { receivedError = error; };

    await rateLimit(redis)(request, response, next);

    expect(receivedError).toBe(redisError);
  });

  test("accepts custom windowSeconds and maxRequests options", async () => {
    const evalArgs: unknown[] = [];
    const redis = {
      eval: mock((...args: unknown[]) => {
        evalArgs.push(...args);
        return Promise.resolve(1);
      }),
    } as unknown as Redis;

    const request = makeRequest("agent-1");
    const { response } = makeResponse();
    await rateLimit(redis, { windowSeconds: 30, maxRequests: 50 })(
      request,
      response,
      () => {},
    );

    const windowMsArg = String(30 * 1_000);
    const maxRequestsArg = "50";
    expect(evalArgs).toContain(windowMsArg);
    expect(evalArgs).toContain(maxRequestsArg);
  });

  test("uses unknown as IP fallback when request.ip is undefined", async () => {
    let capturedKey = "";
    const redis = {
      eval: mock((_script: string, _numkeys: number, key: string) => {
        capturedKey = key;
        return Promise.resolve(1);
      }),
    } as unknown as Redis;

    const request = { ip: undefined, agent: undefined } as unknown as Request;
    const { response } = makeResponse();
    await rateLimit(redis)(request, response, () => {});

    expect(capturedKey).toBe("rate_limit:ip:unknown");
  });
});
