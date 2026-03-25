import { describe, test, expect, mock } from "bun:test";
import type { Pool, QueryResult } from "pg";
import { createPool, query, queryOne } from "./database.ts";

describe("createPool", () => {
  test("returns a Pool instance with a query method", async () => {
    const pool = createPool("postgresql://localhost/test");
    expect(typeof pool.query).toBe("function");
    await pool.end();
  });

  test("returns a Pool instance with a connect method", async () => {
    const pool = createPool("postgresql://localhost/test");
    expect(typeof pool.connect).toBe("function");
    await pool.end();
  });

  test("returns distinct pool instances for each call", async () => {
    const poolA = createPool("postgresql://localhost/test_a");
    const poolB = createPool("postgresql://localhost/test_b");
    expect(poolA).not.toBe(poolB);
    await poolA.end();
    await poolB.end();
  });

  test("accepts a full postgres URI with credentials", async () => {
    const pool = createPool(
      "postgresql://user:password@localhost:5432/mydb",
    );
    expect(pool).toBeDefined();
    await pool.end();
  });
});

describe("query", () => {
  test("returns rows from the pool result", async () => {
    const rows = [{ id: "1", name: "Alice" }];
    const mockPool = {
      query: mock(() =>
        Promise.resolve({ rows } as QueryResult<{ id: string; name: string }>),
      ),
    } as unknown as Pool;

    const result = await query<{ id: string; name: string }>(
      mockPool,
      "SELECT * FROM agents",
    );

    expect(result).toEqual(rows);
  });

  test("passes parameters to pool.query", async () => {
    let capturedParams: unknown[] | undefined;
    const mockPool = {
      query: mock((_text: string, params?: unknown[]) => {
        capturedParams = params;
        return Promise.resolve({ rows: [] } as unknown as QueryResult);
      }),
    } as unknown as Pool;

    await query(mockPool, "SELECT * FROM agents WHERE id = $1", ["abc"]);

    expect(capturedParams).toEqual(["abc"]);
  });

  test("returns empty array when no rows match", async () => {
    const mockPool = {
      query: mock(() =>
        Promise.resolve({ rows: [] } as unknown as QueryResult),
      ),
    } as unknown as Pool;

    const result = await query(mockPool, "SELECT * FROM agents WHERE id = $1", [
      "nonexistent",
    ]);

    expect(result).toEqual([]);
  });
});

describe("queryOne", () => {
  test("returns first row when rows exist", async () => {
    const rows = [{ id: "1" }, { id: "2" }];
    const mockPool = {
      query: mock(() =>
        Promise.resolve({ rows } as unknown as QueryResult),
      ),
    } as unknown as Pool;

    const result = await queryOne<{ id: string }>(
      mockPool,
      "SELECT * FROM agents",
    );

    expect(result).toEqual({ id: "1" });
  });

  test("returns null when rows are empty (boundary)", async () => {
    const mockPool = {
      query: mock(() =>
        Promise.resolve({ rows: [] } as unknown as QueryResult),
      ),
    } as unknown as Pool;

    const result = await queryOne(mockPool, "SELECT * FROM agents WHERE id = $1", [
      "nonexistent",
    ]);

    expect(result).toBeNull();
  });
});
