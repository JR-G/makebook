import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Pool, PoolClient } from "pg";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

/** SQL to create the schema_migrations tracking table. */
const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

/**
 * Reads the list of already-applied migration versions from the database.
 * @param client - An active PostgreSQL client.
 * @returns A set of applied migration version strings.
 */
async function loadAppliedVersions(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  return new Set(result.rows.map((row) => row.version));
}

/**
 * Reads all .sql migration files from the migrations directory, sorted by name.
 * @returns An array of [filename, sql] pairs in ascending order.
 */
async function loadMigrationFiles(): Promise<[string, string][]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries.filter((entry) => entry.endsWith(".sql")).sort();

  const migrations = await Promise.all(
    sqlFiles.map(async (filename): Promise<[string, string]> => {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf-8");
      return [filename, sql];
    }),
  );

  return migrations;
}

/**
 * Applies a single migration file within a transaction.
 * Records the applied version in schema_migrations on success.
 * @param client - An active PostgreSQL client (within a transaction).
 * @param version - The migration filename used as the version key.
 * @param sql - The SQL content to execute.
 */
async function applyMigration(
  client: PoolClient,
  version: string,
  sql: string,
): Promise<void> {
  await client.query(sql);
  await client.query(
    "INSERT INTO schema_migrations (version) VALUES ($1)",
    [version],
  );
}

/**
 * Runs all pending database migrations in order.
 * Each migration is applied in its own transaction; a failure rolls back
 * only that migration and halts the run.
 * @param pool - The PostgreSQL connection pool to use.
 * @returns The number of migrations applied.
 */
export async function runMigrations(pool: Pool): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query(CREATE_MIGRATIONS_TABLE_SQL);

    const appliedVersions = await loadAppliedVersions(client);
    const migrationFiles = await loadMigrationFiles();

    const pending = migrationFiles.filter(
      ([filename]) => !appliedVersions.has(filename),
    );

    for (const [filename, sql] of pending) {
      await client.query("BEGIN");

      try {
        await applyMigration(client, filename, sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${filename} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return pending.length;
  } finally {
    client.release();
  }
}
