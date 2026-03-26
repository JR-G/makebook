import { describe, test, expect } from "bun:test";
import { createPool } from "./database.ts";

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
