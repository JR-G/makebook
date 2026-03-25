import { describe, test, expect, mock } from "bun:test";
import type { Pool, QueryResult } from "pg";
import { AgentService, toPublic } from "./agent.ts";
import type { Agent } from "@makebook/types";

/** Returns a minimal Pool mock whose query always resolves with the given rows. */
function makePool(rows: unknown[] = []): Pool {
  return {
    query: mock(() => Promise.resolve({ rows, rowCount: rows.length })),
  } as unknown as Pool;
}

/** Returns a Pool mock that rejects all queries with the given error. */
function makeErrorPool(error: Error): Pool {
  return {
    query: mock(() => Promise.reject(error)),
  } as unknown as Pool;
}

/**
 * Awaits a Promise that is expected to reject, then returns the caught error.
 * Fails the test if the Promise resolves instead.
 * @param fn - Async operation expected to throw.
 * @returns The thrown error value.
 */
async function catchError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    throw new Error("Expected function to throw but it resolved");
  } catch (error) {
    return error;
  }
}

/** A fully-populated agent row as the database would return it. */
const mockAgentRow = {
  id: "agent-uuid-1",
  user_id: "user-uuid-1",
  name: "test-agent",
  description: "A test agent",
  api_key_hash: "hashedkey1234567890",
  llm_provider: "anthropic",
  status: "active",
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
};

/** Converts the mock row to a domain Agent for comparison. */
const expectedAgent: Agent = {
  id: "agent-uuid-1",
  userId: "user-uuid-1",
  name: "test-agent",
  description: "A test agent",
  apiKeyHash: "hashedkey1234567890",
  llmProvider: "anthropic",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("AgentService", () => {
  describe("register", () => {
    test("creates agent and returns unhashed API key", async () => {
      const pool = makePool([mockAgentRow]);
      const service = new AgentService(pool);

      const result = await service.register("user-uuid-1", {
        name: "test-agent",
      });

      expect(result.apiKey).toMatch(/^mk_/);
      expect(result.apiKey).toHaveLength(67); // "mk_" + 64 hex chars
      expect(result.agent.id).toBe("agent-uuid-1");
    });

    test("returns AgentPublic without apiKeyHash or userId", async () => {
      const pool = makePool([mockAgentRow]);
      const service = new AgentService(pool);

      const result = await service.register("user-uuid-1", {
        name: "test-agent",
      });

      expect(result.agent).not.toHaveProperty("apiKeyHash");
      expect(result.agent).not.toHaveProperty("userId");
      expect(result.agent.name).toBe("test-agent");
    });

    test("throws 400 for empty name", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.register("user-uuid-1", { name: "" }),
      );
      expect(error).toMatchObject({ statusCode: 400 });
    });

    test("throws 400 for name with spaces", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.register("user-uuid-1", { name: "invalid name" }),
      );
      expect(error).toMatchObject({ statusCode: 400 });
    });

    test("throws 400 for name with special characters", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.register("user-uuid-1", { name: "agent@v2!" }),
      );
      expect(error).toMatchObject({ statusCode: 400 });
    });

    test("throws 400 for name longer than 50 characters", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const longName = "a".repeat(51);
      const error = await catchError(() =>
        service.register("user-uuid-1", { name: longName }),
      );
      expect(error).toMatchObject({ statusCode: 400 });
    });

    test("throws 409 for duplicate agent name under same user", async () => {
      const pgError = new Error("unique constraint violation") as Error & {
        code: string;
      };
      pgError.code = "23505";

      const pool = makeErrorPool(pgError);
      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.register("user-uuid-1", { name: "test-agent" }),
      );
      expect(error).toMatchObject({ statusCode: 409 });
    });

    test("updates user credentials when e2bApiKey provided", async () => {
      const queryCalls: unknown[][] = [];
      const pool = {
        query: mock((...args: unknown[]) => {
          queryCalls.push(args);
          return Promise.resolve({ rows: [mockAgentRow], rowCount: 1 });
        }),
      } as unknown as Pool;

      const service = new AgentService(pool);
      await service.register("user-uuid-1", {
        name: "test-agent",
        e2bApiKey: "e2b-key-123",
      });

      expect(queryCalls.length).toBe(2);
    });

    test("does not update user credentials when neither key provided", async () => {
      const queryCalls: unknown[][] = [];
      const pool = {
        query: mock((...args: unknown[]) => {
          queryCalls.push(args);
          return Promise.resolve({ rows: [mockAgentRow], rowCount: 1 });
        }),
      } as unknown as Pool;

      const service = new AgentService(pool);
      await service.register("user-uuid-1", { name: "test-agent" });

      expect(queryCalls.length).toBe(1);
    });
  });

  describe("getById", () => {
    test("returns full Agent for existing ID", async () => {
      const pool = makePool([mockAgentRow]);
      const service = new AgentService(pool);

      const agent = await service.getById("agent-uuid-1");

      expect(agent).toEqual(expectedAgent);
    });

    test("returns null for non-existent ID", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const agent = await service.getById("non-existent-id");

      expect(agent).toBeNull();
    });
  });

  describe("getPublicById", () => {
    test("returns AgentPublic without apiKeyHash or userId", async () => {
      const pool = makePool([mockAgentRow]);
      const service = new AgentService(pool);

      const agent = await service.getPublicById("agent-uuid-1");

      expect(agent).not.toBeNull();
      expect(agent).not.toHaveProperty("apiKeyHash");
      expect(agent).not.toHaveProperty("userId");
      expect(agent?.name).toBe("test-agent");
    });

    test("returns null for non-existent ID", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const agent = await service.getPublicById("non-existent-id");

      expect(agent).toBeNull();
    });
  });

  describe("list", () => {
    test("returns paginated results with correct total count", async () => {
      let callCount = 0;
      const pool = {
        query: mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              rows: [mockAgentRow],
              rowCount: 1,
            } as QueryResult);
          }
          return Promise.resolve({
            rows: [{ total: 5 }],
            rowCount: 1,
          } as QueryResult);
        }),
      } as unknown as Pool;

      const service = new AgentService(pool);
      const result = await service.list({ page: 1, pageSize: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(1);
    });

    test("uses default page=1 and pageSize=20", async () => {
      const capturedParams: unknown[][] = [];
      const pool = {
        query: mock((_sql: string, params: unknown[]) => {
          capturedParams.push(params);
          return Promise.resolve({ rows: [{ total: 0 }], rowCount: 1 });
        }),
      } as unknown as Pool;

      const service = new AgentService(pool);
      await service.list();

      const listParams = capturedParams[0]!;
      expect(listParams[1]).toBe(20); // pageSize
      expect(listParams[2]).toBe(0); // offset = (1-1)*20
    });

    test("passes status filter to query", async () => {
      const capturedParams: unknown[][] = [];
      const pool = {
        query: mock((_sql: string, params: unknown[]) => {
          capturedParams.push(params);
          return Promise.resolve({ rows: [{ total: 0 }], rowCount: 1 });
        }),
      } as unknown as Pool;

      const service = new AgentService(pool);
      await service.list({ status: "inactive" });

      const listParams = capturedParams[0]!;
      expect(listParams[0]).toBe("inactive");
    });
  });

  describe("updateStatus", () => {
    test("updates status and returns updated agent", async () => {
      const updatedRow = { ...mockAgentRow, status: "inactive" };
      const pool = makePool([updatedRow]);
      const service = new AgentService(pool);

      const agent = await service.updateStatus("agent-uuid-1", "inactive");

      expect(agent.status).toBe("inactive");
    });

    test("throws 404 for non-existent agent", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.updateStatus("non-existent-id", "inactive"),
      );
      expect(error).toMatchObject({ statusCode: 404 });
    });

    test("throws 400 for invalid status value", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.updateStatus("agent-uuid-1", "suspended" as never),
      );
      expect(error).toMatchObject({ statusCode: 400 });
    });
  });

  describe("rotateApiKey", () => {
    test("returns new API key with correct format", async () => {
      const pool = makePool([mockAgentRow]);
      const service = new AgentService(pool);

      const result = await service.rotateApiKey("agent-uuid-1", "user-uuid-1");

      expect(result.apiKey).toMatch(/^mk_/);
    });

    test("throws 403 when userId does not match agent owner", async () => {
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

      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.rotateApiKey("agent-uuid-1", "wrong-user-id"),
      );
      expect(error).toMatchObject({ statusCode: 403 });
    });

    test("throws 404 when agent does not exist at all", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const error = await catchError(() =>
        service.rotateApiKey("non-existent-id", "user-uuid-1"),
      );
      expect(error).toMatchObject({ statusCode: 404 });
    });

    test("old key hash differs from new key hash (key was actually rotated)", async () => {
      const capturedHashes: string[] = [];
      const pool = {
        query: mock((_sql: string, params: unknown[]) => {
          if (typeof params[0] === "string" && params[0].length === 64) {
            capturedHashes.push(params[0]);
          }
          return Promise.resolve({ rows: [mockAgentRow], rowCount: 1 });
        }),
      } as unknown as Pool;

      const service = new AgentService(pool);
      await service.rotateApiKey("agent-uuid-1", "user-uuid-1");
      await service.rotateApiKey("agent-uuid-1", "user-uuid-1");

      expect(capturedHashes[0]).not.toBe(capturedHashes[1]);
    });
  });

  describe("getByUserId", () => {
    test("returns agents belonging to user", async () => {
      const pool = makePool([mockAgentRow]);
      const service = new AgentService(pool);

      const agents = await service.getByUserId("user-uuid-1");

      expect(agents).toHaveLength(1);
      expect(agents[0]?.name).toBe("test-agent");
    });

    test("returns empty array for user with no agents", async () => {
      const pool = makePool([]);
      const service = new AgentService(pool);

      const agents = await service.getByUserId("user-with-no-agents");

      expect(agents).toEqual([]);
    });
  });

  describe("toPublic", () => {
    test("strips apiKeyHash and userId from agent", () => {
      const publicAgent = toPublic(expectedAgent);

      expect(publicAgent).not.toHaveProperty("apiKeyHash");
      expect(publicAgent).not.toHaveProperty("userId");
      expect(publicAgent.id).toBe(expectedAgent.id);
      expect(publicAgent.name).toBe(expectedAgent.name);
    });
  });
});
