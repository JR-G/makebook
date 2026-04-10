import { describe, test, expect, mock } from "bun:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { runMigrations } from "./migrate.ts";

function makeClient(
  appliedVersions: string[],
  shouldFailOnVersion?: string,
): PoolClient {
  const queries: string[] = [];

  const client = {
    query: mock(async (sql: string, params?: string[]) => {
      queries.push(sql);

      if (sql.trim().startsWith("SELECT version")) {
        return {
          rows: appliedVersions.map((version) => ({ version })),
        } as QueryResult;
      }

      if (
        shouldFailOnVersion &&
        params?.[0] === shouldFailOnVersion &&
        sql.includes("INSERT INTO schema_migrations")
      ) {
        throw new Error(`Simulated failure for ${shouldFailOnVersion}`);
      }

      return { rows: [] } as unknown as QueryResult;
    }),
    release: mock(() => {}),
  } as unknown as PoolClient;

  return client;
}

function makePool(client: PoolClient): Pool {
  return {
    connect: mock(() => Promise.resolve(client)),
  } as unknown as Pool;
}

describe("runMigrations", () => {
  test("returns 0 when no new migrations are pending", async () => {
    const client = makeClient([
      "001_create_agents.sql",
      "002_create_users.sql",
      "003_infra_credentials.sql",
      "004_create_projects_contributions.sql",
      "005_create_shared_pool_usage.sql",
    ]);
    const pool = makePool(client);

    const count = await runMigrations(pool);

    expect(count).toBe(0);
  });

  test("releases the client after running migrations", async () => {
    const client = makeClient([]);
    const pool = makePool(client);

    await runMigrations(pool);

    expect(client.release).toHaveBeenCalled();
  });

  test("releases the client even when a migration fails", async () => {
    const client = makeClient([], "001_create_agents.sql");

    const queryMock = mock(async (sql: string) => {
      if (sql.includes("INSERT INTO schema_migrations")) {
        throw new Error("Forced failure");
      }
      return { rows: [] } as unknown as QueryResult;
    });

    (client as unknown as Record<string, unknown>)["query"] = queryMock;
    const pool = makePool(client);

    try {
      await runMigrations(pool);
    } catch {
      // expected
    }

    expect(client.release).toHaveBeenCalled();
  });

  test("creates schema_migrations table on first run", async () => {
    const executedSqls: string[] = [];
    const client = {
      query: mock(async (sql: string) => {
        executedSqls.push(sql);
        if (sql.includes("SELECT version")) {
          return { rows: [] } as unknown as QueryResult;
        }
        return { rows: [] } as unknown as QueryResult;
      }),
      release: mock(() => {}),
    } as unknown as PoolClient;

    const pool = makePool(client);
    await runMigrations(pool);

    const createsTable = executedSqls.some((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations"),
    );
    expect(createsTable).toBe(true);
  });

  test("wraps each migration in a transaction", async () => {
    const executedSqls: string[] = [];
    const client = {
      query: mock(async (sql: string) => {
        executedSqls.push(sql.trim());
        if (sql.includes("SELECT version")) {
          return { rows: [] } as unknown as QueryResult;
        }
        return { rows: [] } as unknown as QueryResult;
      }),
      release: mock(() => {}),
    } as unknown as PoolClient;

    const pool = makePool(client);
    await runMigrations(pool);

    expect(executedSqls).toContain("BEGIN");
    expect(executedSqls).toContain("COMMIT");
  });
});
