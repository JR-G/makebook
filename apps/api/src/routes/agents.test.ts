import { describe, test, expect, afterEach, mock } from "bun:test";
import type { Server } from "node:http";
import { createHmac } from "node:crypto";
import type { Pool, QueryResult } from "pg";
import type Redis from "ioredis";
import { createApp } from "../app.ts";

const TEST_JWT_SECRET = "test-secret-at-least-16-chars";

/**
 * Signs a minimal HS256 JWT for use in test Authorization headers.
 * @param payload - Claims to embed (should include sub and email).
 * @returns A signed JWT string.
 */
function signTestJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${body}`;
  const signature = createHmac("sha256", TEST_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

const TEST_USER_TOKEN = signTestJwt({
  sub: "user-uuid-1",
  email: "user@example.com",
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const mockAgentRow = {
  id: "agent-uuid-1",
  user_id: "user-uuid-1",
  name: "test-agent",
  description: "A test agent",
  api_key_hash: "hashedkey",
  llm_provider: "anthropic",
  status: "active",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
};

let server: Server | undefined;

function makeRedis(): Redis {
  return {
    eval: mock(() => Promise.resolve(1)),
    disconnect: mock(() => {}),
  } as unknown as Redis;
}

function makePool(rows: unknown[] = []): Pool {
  return {
    query: mock(() =>
      Promise.resolve({ rows, rowCount: rows.length } as QueryResult),
    ),
  } as unknown as Pool;
}

function startServer(pool: Pool): Promise<number> {
  return new Promise((resolve) => {
    const app = createApp({
      pool,
      redis: makeRedis(),
      jwtSecret: TEST_JWT_SECRET,
    });
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

describe("POST /agents", () => {
  test("returns 201 with agent and API key", async () => {
    const pool = makePool([mockAgentRow]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_USER_TOKEN}`,
      },
      body: JSON.stringify({ name: "test-agent" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      success: boolean;
      data: { agent: { name: string }; apiKey: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.apiKey).toMatch(/^mk_/);
    expect(body.data.agent.name).toBe("test-agent");
  });

  test("returns 401 without auth token", async () => {
    const pool = makePool([]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-agent" }),
    });

    expect(response.status).toBe(401);
  });

  test("returns 400 for missing name", async () => {
    const pool = makePool([]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_USER_TOKEN}`,
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 for invalid agent name characters", async () => {
    const pool = makePool([]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_USER_TOKEN}`,
      },
      body: JSON.stringify({ name: "bad name!" }),
    });

    expect(response.status).toBe(400);
  });
});

describe("GET /agents", () => {
  test("returns paginated agent list", async () => {
    let callCount = 0;
    const pool = {
      query: mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ rows: [mockAgentRow], rowCount: 1 });
        }
        return Promise.resolve({ rows: [{ total: 1 }], rowCount: 1 });
      }),
    } as unknown as Pool;

    const port = await startServer(pool);
    const response = await fetch(`http://localhost:${port}/agents`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { items: unknown[]; total: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.total).toBe(1);
  });

  test("supports status filter query param", async () => {
    const capturedParams: unknown[][] = [];
    const pool = {
      query: mock((_sql: string, params: unknown[]) => {
        capturedParams.push(params);
        return Promise.resolve({ rows: [{ total: 0 }], rowCount: 1 });
      }),
    } as unknown as Pool;

    const port = await startServer(pool);
    await fetch(`http://localhost:${port}/agents?status=inactive`);

    const listCallParams = capturedParams[0]!;
    expect(listCallParams[0]).toBe("inactive");
  });
});

describe("GET /agents/me", () => {
  test("returns agents for authenticated user", async () => {
    const pool = makePool([mockAgentRow]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/agents/me`, {
      headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: unknown[];
    };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("returns 401 without auth token", async () => {
    const pool = makePool([]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/agents/me`);

    expect(response.status).toBe(401);
  });
});

describe("GET /agents/:id", () => {
  test("returns public agent profile", async () => {
    const pool = makePool([mockAgentRow]);
    const port = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/agents/agent-uuid-1`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { id: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("agent-uuid-1");
  });

  test("returns 404 for non-existent agent", async () => {
    const pool = makePool([]);
    const port = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/agents/non-existent`,
    );

    expect(response.status).toBe(404);
  });
});

describe("POST /agents/:id/rotate-key", () => {
  test("returns new API key", async () => {
    const pool = makePool([mockAgentRow]);
    const port = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/agents/agent-uuid-1/rotate-key`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` },
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { apiKey: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.apiKey).toMatch(/^mk_/);
  });

  test("returns 401 without auth token", async () => {
    const pool = makePool([]);
    const port = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/agents/agent-uuid-1/rotate-key`,
      { method: "POST" },
    );

    expect(response.status).toBe(401);
  });

  test("returns 403 when user does not own the agent", async () => {
    let callCount = 0;
    const pool = {
      query: mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({
          rows: [{ id: "agent-uuid-1" }],
          rowCount: 1,
        });
      }),
    } as unknown as Pool;

    const port = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/agents/agent-uuid-1/rotate-key`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` },
      },
    );

    expect(response.status).toBe(403);
  });
});
