import { Pool } from "pg";

/** PostgreSQL connection pool configuration defaults. */
const POOL_MAX_CONNECTIONS = 10;
const POOL_IDLE_TIMEOUT_MS = 30_000;
const POOL_CONNECTION_TIMEOUT_MS = 2_000;

/**
 * Creates a PostgreSQL connection pool for the given connection string.
 * Uses sensible defaults for connection limits and timeouts.
 * @param connectionString - PostgreSQL connection URI.
 * @returns A configured pg Pool instance.
 */
export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  });
}
