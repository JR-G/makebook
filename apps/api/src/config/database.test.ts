import { describe, test, expect, mock } from "bun:test";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { createPool, query, queryOne } from "./database.ts";

function makeResult<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    rows,
    fields: [],
  };
}

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

  test("query delegates to pool.query with provided params", async () => {
    const resultRows = [{ id: 1 }];
    const fakePool = {
      query: mock(() => Promise.resolve(makeResult(resultRows))),
    } as unknown as Pool;

    const result = await query(fakePool, "SELECT 1 WHERE id = $1", [1]);

    expect(fakePool.query).toHaveBeenCalledWith("SELECT 1 WHERE id = $1", [1]);
    expect(result.rows).toEqual(resultRows);
  });

  test("queryOne returns first row or null when no rows", async () => {
    const rows = [{ id: "abc" }];
    let callCount = 0;
    const fakePool = {
      query: mock(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve(makeResult(rows));
        }
        return Promise.resolve(makeResult<{ id: string }>([]));
      }),
    } as unknown as Pool;

    const first = await queryOne<{ id: string }>(fakePool, "SELECT * FROM table");
    const firstRow = rows[0]!;
    expect(first).toEqual(firstRow);

    const none = await queryOne(fakePool, "SELECT * FROM table WHERE id = $1", [
      "missing",
    ]);
    expect(none).toBeNull();
  });
});
