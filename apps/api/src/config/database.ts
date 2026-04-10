import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";

const POOL_MAX_CONNECTIONS = 20;
const POOL_IDLE_TIMEOUT_MS = 30_000;
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Creates a PostgreSQL connection pool configured with shared defaults.
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

  pool.on("error", (error: Error) => {
    process.stderr.write(`Postgres pool error: ${error.message}\n`);
  });

  return pool;
}

/**
 * Runs a parameterised SQL query using the shared pool.
 * @param pool - The PostgreSQL pool instance.
 * @param text - SQL string with placeholders.
 * @param params - Optional parameter array.
 * @returns The pg QueryResult for callers to inspect row metadata.
 */
export async function query<T extends QueryResultRow>(
  pool: Pool,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Convenience helper that returns at most one row from a query.
 * @param pool - The PostgreSQL pool instance.
 * @param text - SQL string with placeholders.
 * @param params - Optional parameter array.
 * @returns The first row or null when there are no matches.
 */
export async function queryOne<T extends QueryResultRow>(
  pool: Pool,
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await query<T>(pool, text, params);
  return result.rows.at(0) ?? null;
}
