import { Pool } from "pg";
import type { QueryResultRow } from "pg";

/** Maximum number of concurrent PostgreSQL connections in the pool. */
const POOL_MAX_CONNECTIONS = 20;

/** Milliseconds before an idle connection is released. */
const POOL_IDLE_TIMEOUT_MS = 30_000;

/** Milliseconds to wait when acquiring a connection from the pool. */
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Creates a PostgreSQL connection pool for the given connection string.
 * Attaches a stderr error handler to prevent unhandled 'error' events from crashing the process.
 * @param connectionString - PostgreSQL connection URI.
 * @returns A configured pg Pool instance.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  });

  pool.on("error", (error) => {
    process.stderr.write(`PostgreSQL pool error: ${error.message}\n`);
  });

  return pool;
}

/**
 * Executes a parameterised SQL query and returns all matching rows.
 * @param pool - The PostgreSQL connection pool to use.
 * @param text - The SQL query string.
 * @param params - Optional query parameters.
 * @returns An array of rows cast to type T.
 */
export async function query<T extends QueryResultRow>(
  pool: Pool,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * Executes a parameterised SQL query and returns the first matching row, or null.
 * @param pool - The PostgreSQL connection pool to use.
 * @param text - The SQL query string.
 * @param params - Optional query parameters.
 * @returns The first row cast to type T, or null if no rows were returned.
 */
export async function queryOne<T extends QueryResultRow>(
  pool: Pool,
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(pool, text, params);
  return rows[0] ?? null;
}
