import type { Pool } from "pg";

/**
 * Creates a PostgreSQL connection pool for the given connection string.
 * @param _connectionString - PostgreSQL connection URI.
 * @throws {Error} Stub — not yet implemented.
 */
export function createPool(_connectionString: string): Pool {
  throw new Error("Database pool not yet implemented.");
}
