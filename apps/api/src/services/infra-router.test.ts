import { describe, it, expect, mock } from "bun:test";
import type { Pool } from "pg";
import { InfraRouter, type InfraConfig } from "./infra-router.ts";

const defaultConfig: InfraConfig = {
  sharedPoolMaxSandboxHours: 100,
  sharedPoolMaxConcurrent: 10,
  sharedPoolMaxDeployed: 20,
  sharedPoolMaxBuildsPerAgent: 5,
};

/** Creates a mock pool whose query function returns canned rows in call order. */
function makePool(responses: { rows: unknown[] }[]): Pool {
  let callIndex = 0;
  return {
    query: mock((..._args: unknown[]) => {
      const response = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(response);
    }),
  } as unknown as Pool;
}

/** Creates a single-purpose mock pool and exposes the query spy for inspection. */
function makeSingleQueryPool(rows: unknown[] = []): {
  pool: Pool;
  spy: ReturnType<typeof mock>;
} {
  const spy = mock((..._args: unknown[]) => Promise.resolve({ rows }));
  return { pool: { query: spy } as unknown as Pool, spy };
}

describe("InfraRouter", () => {
  describe("decideBuildInfra", () => {
    it("returns user_hosted when agent owner has e2b_api_key", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: "user-e2b-key", fly_api_token: null }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideBuildInfra("agent-uuid-1");

      expect(result).toEqual({ type: "user_hosted", e2bKey: "user-e2b-key" });
    });

    it("checks user_hosted BEFORE shared pool (only one query issued)", async () => {
      const { pool, spy } = makeSingleQueryPool([
        { e2b_api_key: "user-e2b-key", fly_api_token: null },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      await router.decideBuildInfra("agent-uuid-1");

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("returns shared when pool has capacity", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ total_seconds: "0", agent_build_count: "0" }] },
        { rows: [{ active_count: "2", pending_count: "1" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideBuildInfra("agent-uuid-1");

      expect(result).toEqual({ type: "shared" });
    });

    it("returns queued when agent exceeds daily build limit", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ total_seconds: "0", agent_build_count: "5" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideBuildInfra("agent-uuid-1");

      expect(result).toEqual({ type: "queued", position: -1 });
    });

    it("returns queued when total sandbox hours exhausted", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ total_seconds: String(100 * 3600), agent_build_count: "0" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideBuildInfra("agent-uuid-1");

      expect(result).toEqual({ type: "queued", position: 0 });
    });

    it("returns queued with pending position when concurrent sandbox limit reached", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ total_seconds: "0", agent_build_count: "0" }] },
        { rows: [{ active_count: "10", pending_count: "3" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideBuildInfra("agent-uuid-1");

      expect(result).toEqual({ type: "queued", position: 3 });
    });

    it("returns queued with position 0 when at concurrency limit but no pending contributions", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ total_seconds: "0", agent_build_count: "0" }] },
        { rows: [{ active_count: "10", pending_count: "0" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideBuildInfra("agent-uuid-1");

      expect(result).toEqual({ type: "queued", position: 0 });
    });

    it("falls through to shared pool when agent has no user link (no row returned)", async () => {
      const pool = makePool([
        { rows: [] },
        { rows: [{ total_seconds: "0", agent_build_count: "0" }] },
        { rows: [{ active_count: "0", pending_count: "0" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideBuildInfra("agent-uuid-orphan");

      expect(result).toEqual({ type: "shared" });
    });
  });

  describe("decideDeployInfra", () => {
    it("returns user_hosted when agent owner has fly_api_token", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: "user-fly-token" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideDeployInfra("agent-uuid-1");

      expect(result).toEqual({
        type: "user_hosted",
        flyToken: "user-fly-token",
      });
    });

    it("returns shared when under deploy limit", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ deployed_count: "5" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideDeployInfra("agent-uuid-1");

      expect(result).toEqual({ type: "shared" });
    });

    it("returns queued when max deployed apps reached", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ deployed_count: "20" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideDeployInfra("agent-uuid-1");

      expect(result).toEqual({ type: "queued", position: 0 });
    });

    it("returns queued when deployed apps exceed the limit (over-cap boundary)", async () => {
      const pool = makePool([
        { rows: [{ e2b_api_key: null, fly_api_token: null }] },
        { rows: [{ deployed_count: "25" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const result = await router.decideDeployInfra("agent-uuid-1");

      expect(result).toEqual({ type: "queued", position: 0 });
    });
  });

  describe("recordUsage", () => {
    it("executes UPSERT with correct agent and seconds parameters", async () => {
      const { pool, spy } = makeSingleQueryPool();
      const router = new InfraRouter(pool, defaultConfig);

      await router.recordUsage("agent-uuid-1", 3600);

      expect(spy).toHaveBeenCalledTimes(1);
      const [sql, params] = spy.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("ON CONFLICT");
      expect(sql).toContain("DO UPDATE");
      expect(params).toEqual(["agent-uuid-1", 3600]);
    });

    it("inserts new row for first usage of the day", async () => {
      const { pool, spy } = makeSingleQueryPool();
      const router = new InfraRouter(pool, defaultConfig);

      await router.recordUsage("agent-uuid-new", 1800);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("increments existing row on subsequent calls (UPSERT semantics)", async () => {
      const { pool, spy } = makeSingleQueryPool();
      const router = new InfraRouter(pool, defaultConfig);

      await router.recordUsage("agent-uuid-1", 1800);
      await router.recordUsage("agent-uuid-1", 900);

      expect(spy).toHaveBeenCalledTimes(2);
      const calls = spy.mock.calls as [string, unknown[]][];
      for (const [sql] of calls) {
        expect(sql).toContain("ON CONFLICT");
      }
    });
  });

  describe("getStatus", () => {
    it("returns correct remaining hours based on config limit minus usage", async () => {
      const pool = makePool([
        {
          rows: [{ total_seconds: String(50 * 3600), active_sandboxes: "3", deployed_apps: "5" }],
        },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const status = await router.getStatus();

      expect(status.sandboxHoursUsedToday).toBe(50);
      expect(status.sandboxHoursLimitToday).toBe(100);
      expect(status.sandboxHoursRemaining).toBe(50);
      expect(status.activeSandboxes).toBe(3);
      expect(status.deployedApps).toBe(5);
      expect(status.maxConcurrentSandboxes).toBe(10);
      expect(status.maxDeployedApps).toBe(20);
    });

    it("returns zero remaining when pool is fully exhausted", async () => {
      const pool = makePool([
        {
          rows: [{ total_seconds: String(100 * 3600), active_sandboxes: "10", deployed_apps: "20" }],
        },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const status = await router.getStatus();

      expect(status.sandboxHoursRemaining).toBe(0);
      expect(status.sandboxHoursUsedToday).toBe(100);
    });

    it("returns correct active sandbox and deployed app counts", async () => {
      const pool = makePool([
        { rows: [{ total_seconds: "0", active_sandboxes: "7", deployed_apps: "12" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const status = await router.getStatus();

      expect(status.activeSandboxes).toBe(7);
      expect(status.deployedApps).toBe(12);
    });

    it("returns zeroed status for a fresh day with no usage", async () => {
      const pool = makePool([
        { rows: [{ total_seconds: "0", active_sandboxes: "0", deployed_apps: "0" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const status = await router.getStatus();

      expect(status.sandboxHoursUsedToday).toBe(0);
      expect(status.sandboxHoursRemaining).toBe(100);
      expect(status.activeSandboxes).toBe(0);
      expect(status.deployedApps).toBe(0);
    });

    it("clamps remaining hours to zero when usage exceeds the configured limit", async () => {
      const pool = makePool([
        { rows: [{ total_seconds: String(150 * 3600), active_sandboxes: "0", deployed_apps: "0" }] },
      ]);
      const router = new InfraRouter(pool, defaultConfig);

      const status = await router.getStatus();

      expect(status.sandboxHoursRemaining).toBe(0);
      expect(status.sandboxHoursUsedToday).toBe(150);
    });
  });
});
