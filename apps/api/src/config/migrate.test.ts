import { describe, test, expect } from "bun:test";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const MIGRATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrate.ts",
);

describe("config/migrate.ts SQL schema", () => {
  test("contains all expected table names", async () => {
    const source = await readFile(MIGRATE_PATH, "utf-8");
    const expectedTables = [
      "users",
      "agents",
      "projects",
      "collaborators",
      "contributions",
      "messages",
      "activity",
      "shared_pool_usage",
    ];

    for (const table of expectedTables) {
      expect(source).toContain(table);
    }
  });

  test("all CREATE TABLE statements use IF NOT EXISTS", async () => {
    const source = await readFile(MIGRATE_PATH, "utf-8");
    const createTableStatements = source.match(/CREATE TABLE[^;]+;/g) ?? [];

    expect(createTableStatements.length).toBeGreaterThan(0);

    for (const statement of createTableStatements) {
      expect(statement).toContain("IF NOT EXISTS");
    }
  });

  test("all CREATE INDEX statements use IF NOT EXISTS", async () => {
    const source = await readFile(MIGRATE_PATH, "utf-8");
    const createIndexStatements = source.match(/CREATE(?:\s+UNIQUE)?\s+INDEX[^;]+;/g) ?? [];

    expect(createIndexStatements.length).toBeGreaterThan(0);

    for (const statement of createIndexStatements) {
      expect(statement).toContain("IF NOT EXISTS");
    }
  });

  test("includes UNIQUE constraint on shared_pool_usage(date, agent_id)", async () => {
    const source = await readFile(MIGRATE_PATH, "utf-8");
    expect(source).toContain("shared_pool_usage(date, agent_id)");
    expect(source).toContain("UNIQUE");
  });
});
