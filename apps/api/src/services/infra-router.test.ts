import { describe, test, expect, mock } from "bun:test";
import type { Pool } from "pg";
import { InfraRouter } from "./infra-router.ts";
import type { InfraConfig, PoolMetricsProvider } from "./infra-router.ts";
import type { CredentialCipher } from "./credential-cipher.ts";

/** Identity cipher used in tests — DB mock returns plaintext directly. */
const identityCipher: CredentialCipher = {
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
};

const TEST_CONFIG: InfraConfig = {
  sharedPoolMaxSandboxHours: 100,
  sharedPoolMaxConcurrent: 5,
  sharedPoolMaxDeployed: 10,
  sharedPoolMaxBuildsPerAgent: 5,
};

/**
 * Creates a mock Pool that returns canned responses in order, one per query call.
 * Excess calls beyond the provided responses return empty rows.
 */
function makeSequentialPool(responses: { rows: unknown[] }[]): Pool {
  let callIndex = 0;
  return {
    query: mock(() => {
      const response = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve({ rows: response.rows, rowCount: response.rows.length });
    }),
  } as unknown as Pool;
}

/**
 * Creates a mock Pool that dispatches responses based on a substring match
 * against the SQL string. Order-independent — safe for Promise.all queries.
 *
 * Each handler must supply a unique `match` fragment from its SQL statement.
 * The first matching handler wins; unmatched queries return empty rows.
 */
function makeContentAwarePool(
  handlers: { match: string; rows: unknown[] }[],
): Pool {
  return {
    query: mock((sql: string) => {
      const handler = handlers.find((handler) => sql.includes(handler.match));
      const rows = handler?.rows ?? [];
      return Promise.resolve({ rows, rowCount: rows.length });
    }),
  } as unknown as Pool;
}

/**
 * Creates a mock PoolMetricsProvider with configurable counts.
 * Defaults all counts to zero unless overridden.
 */
function makeMetrics(overrides: {
  activeSandboxes?: number;
  pendingSandboxes?: number;
  deployedApps?: number;
} = {}): PoolMetricsProvider {
  return {
    getActiveSandboxCount: mock(() => Promise.resolve(overrides.activeSandboxes ?? 0)),
    getPendingSandboxCount: mock(() => Promise.resolve(overrides.pendingSandboxes ?? 0)),
    getDeployedAppCount: mock(() => Promise.resolve(overrides.deployedApps ?? 0)),
  };
}

describe("decideBuildInfra", () => {
  test("returns user_hosted when agent's owner has e2b_api_key", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: "user-e2b-key-abc" }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "user_hosted", e2bKey: "user-e2b-key-abc" });
  });

  test("checks user_hosted before shared pool — stops after one query", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: "user-e2b-key-abc" }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    await router.decideBuildInfra("agent-1");

    expect((pool.query as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("returns shared when pool has capacity", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },            // user lookup — no key
      { rows: [] },                                   // agent usage — no record today
      { rows: [{ total_seconds: "0" }] },            // total pool usage
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ activeSandboxes: 0 }));

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "shared" });
  });

  test("returns shared when agent has used some builds but is under the limit", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [{ build_count: 4 }] },               // 4 builds, limit is 5
      { rows: [{ total_seconds: "3600" }] },         // 1 hour used, limit is 100
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ activeSandboxes: 2 }));

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "shared" });
  });

  test("returns queued when agent exceeds daily build limit", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [{ build_count: 5 }] },               // exactly at the limit
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: -1 });
  });

  test("returns queued with position -1 when agent build count exceeds limit", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [{ build_count: 99 }] },              // well over the limit
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: -1 });
  });

  test("returns queued when total sandbox hours exhausted", async () => {
    // 100 hours * 3600 = 360000 seconds
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [] },                                   // no agent usage yet
      { rows: [{ total_seconds: "360000" }] },       // exactly at the limit
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: 0 });
  });

  test("returns queued when pool usage exceeds configured limit", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [{ build_count: 0 }] },
      { rows: [{ total_seconds: "999999" }] },       // far over limit
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: 0 });
  });

  test("returns queued with pending count as position when concurrent limit reached", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [{ build_count: 0 }] },
      { rows: [{ total_seconds: "0" }] },
    ]);
    const router = new InfraRouter(
      pool,
      TEST_CONFIG,
      identityCipher,
      makeMetrics({ activeSandboxes: 5, pendingSandboxes: 3 }),  // at limit, 3 pending → position 3
    );

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: 3 });
  });

  test("returns queued with position 0 when at concurrency limit and no pending builds", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [{ build_count: 0 }] },
      { rows: [{ total_seconds: "0" }] },
    ]);
    const router = new InfraRouter(
      pool,
      TEST_CONFIG,
      identityCipher,
      makeMetrics({ activeSandboxes: 10, pendingSandboxes: 0 }),  // over limit, none pending
    );

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: 0 });
  });

  test("treats missing user record (no JOIN match) as no user key", async () => {
    const pool = makeSequentialPool([
      { rows: [] },                                   // no user found for agent
      { rows: [] },                                   // no agent usage
      { rows: [{ total_seconds: "0" }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ activeSandboxes: 0 }));

    const decision = await router.decideBuildInfra("agent-orphan");

    expect(decision).toEqual({ type: "shared" });
  });

  test("handles fresh day with zero usage — returns shared", async () => {
    const pool = makeSequentialPool([
      { rows: [{ e2b_api_key: null }] },
      { rows: [] },                                   // no shared_pool_usage row yet
      { rows: [{ total_seconds: "0" }] },            // COALESCE returns 0
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ activeSandboxes: 0 }));

    const decision = await router.decideBuildInfra("agent-1");

    expect(decision).toEqual({ type: "shared" });
  });
});

describe("decideDeployInfra", () => {
  test("returns user_hosted when agent's owner has fly_api_token", async () => {
    const pool = makeSequentialPool([
      { rows: [{ fly_api_token: "user-fly-token-xyz" }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const decision = await router.decideDeployInfra("agent-1");

    expect(decision).toEqual({
      type: "user_hosted",
      flyToken: "user-fly-token-xyz",
    });
  });

  test("returns shared when under deploy limit", async () => {
    const pool = makeSequentialPool([
      { rows: [{ fly_api_token: null }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ deployedApps: 9 }));

    const decision = await router.decideDeployInfra("agent-1");

    expect(decision).toEqual({ type: "shared" });
  });

  test("returns queued when max deployed apps reached", async () => {
    const pool = makeSequentialPool([
      { rows: [{ fly_api_token: null }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ deployedApps: 10 }));

    const decision = await router.decideDeployInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: 0 });
  });

  test("returns queued when deployed apps exceed the limit", async () => {
    const pool = makeSequentialPool([
      { rows: [{ fly_api_token: null }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ deployedApps: 25 }));

    const decision = await router.decideDeployInfra("agent-1");

    expect(decision).toEqual({ type: "queued", position: 0 });
  });

  test("checks user_hosted before shared pool — stops after one query", async () => {
    const pool = makeSequentialPool([
      { rows: [{ fly_api_token: "user-fly-token-xyz" }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    await router.decideDeployInfra("agent-1");

    expect((pool.query as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("treats missing user record as no fly token — falls back to shared pool check", async () => {
    const pool = makeSequentialPool([
      { rows: [] },                                   // no user found
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics({ deployedApps: 0 }));

    const decision = await router.decideDeployInfra("agent-orphan");

    expect(decision).toEqual({ type: "shared" });
  });
});

describe("recordUsage", () => {
  test("inserts new row for first usage of the day", async () => {
    const pool = makeSequentialPool([{ rows: [] }]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    await router.recordUsage("agent-1", 300);

    const calls = (pool.query as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(1);
    const [sql, params] = calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO shared_pool_usage");
    expect(params).toEqual(["agent-1", 300]);
  });

  test("uses UPSERT — ON CONFLICT DO UPDATE for subsequent calls", async () => {
    const pool = makeSequentialPool([{ rows: [] }, { rows: [] }]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    await router.recordUsage("agent-1", 120);
    await router.recordUsage("agent-1", 240);

    const calls = (pool.query as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBe(2);
    const [sql] = calls[1] as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (date, agent_id) DO UPDATE");
    expect(sql).toContain("sandbox_seconds = shared_pool_usage.sandbox_seconds +");
    expect(sql).toContain("build_count = shared_pool_usage.build_count + 1");
  });

  test("passes agentId and sandboxSeconds as query parameters", async () => {
    const pool = makeSequentialPool([{ rows: [] }]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    await router.recordUsage("agent-xyz", 7200);

    const [, params] = (pool.query as ReturnType<typeof mock>).mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBe("agent-xyz");
    expect(params[1]).toBe(7200);
  });
});

describe("getStatus", () => {
  test("returns correct remaining hours based on config limit minus usage", async () => {
    const pool = makeContentAwarePool([
      { match: "sandbox_seconds", rows: [{ total_seconds: "36000" }] },
    ]);
    const router = new InfraRouter(
      pool,
      TEST_CONFIG,
      identityCipher,
      makeMetrics({ activeSandboxes: 2, deployedApps: 3 }),
    );

    const status = await router.getStatus();

    expect(status.sandboxHoursUsedToday).toBeCloseTo(10);
    expect(status.sandboxHoursLimitToday).toBe(100);
    expect(status.sandboxHoursRemaining).toBeCloseTo(90);
    expect(status.activeSandboxes).toBe(2);
    expect(status.maxConcurrentSandboxes).toBe(5);
    expect(status.deployedApps).toBe(3);
    expect(status.maxDeployedApps).toBe(10);
  });

  test("returns zero remaining when fully exhausted", async () => {
    const pool = makeContentAwarePool([
      { match: "sandbox_seconds", rows: [{ total_seconds: "360000" }] }, // 100 hours — exactly at limit
    ]);
    const router = new InfraRouter(
      pool,
      TEST_CONFIG,
      identityCipher,
      makeMetrics({ activeSandboxes: 5, deployedApps: 10 }),
    );

    const status = await router.getStatus();

    expect(status.sandboxHoursRemaining).toBe(0);
  });

  test("clamps remaining to zero when usage exceeds configured limit", async () => {
    const pool = makeContentAwarePool([
      { match: "sandbox_seconds", rows: [{ total_seconds: "999999" }] }, // far over limit
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const status = await router.getStatus();

    expect(status.sandboxHoursRemaining).toBe(0);
  });

  test("returns correct active sandbox count", async () => {
    const pool = makeContentAwarePool([
      { match: "sandbox_seconds", rows: [{ total_seconds: "0" }] },
    ]);
    const router = new InfraRouter(
      pool,
      TEST_CONFIG,
      identityCipher,
      makeMetrics({ activeSandboxes: 4 }),
    );

    const status = await router.getStatus();

    expect(status.activeSandboxes).toBe(4);
  });

  test("returns zeroed status for a fresh day with no usage", async () => {
    const pool = makeContentAwarePool([
      { match: "sandbox_seconds", rows: [{ total_seconds: "0" }] },
    ]);
    const router = new InfraRouter(pool, TEST_CONFIG, identityCipher, makeMetrics());

    const status = await router.getStatus();

    expect(status.sandboxHoursUsedToday).toBe(0);
    expect(status.sandboxHoursRemaining).toBe(100);
    expect(status.activeSandboxes).toBe(0);
    expect(status.deployedApps).toBe(0);
  });

  test("reflects config limits in maxConcurrentSandboxes and maxDeployedApps", async () => {
    const customConfig: InfraConfig = {
      ...TEST_CONFIG,
      sharedPoolMaxConcurrent: 20,
      sharedPoolMaxDeployed: 50,
    };
    const pool = makeContentAwarePool([
      { match: "sandbox_seconds", rows: [{ total_seconds: "0" }] },
    ]);
    const router = new InfraRouter(pool, customConfig, identityCipher, makeMetrics());

    const status = await router.getStatus();

    expect(status.maxConcurrentSandboxes).toBe(20);
    expect(status.maxDeployedApps).toBe(50);
  });
});
