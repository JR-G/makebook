import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { extractApiKey, hashApiKey } from "@makebook/auth";

/** SQL query to look up an active agent by their hashed API key. */
const AGENT_LOOKUP_SQL =
  "SELECT id, name FROM agents WHERE api_key_hash = $1 AND status = 'active'";

/**
 * Middleware factory that validates Bearer tokens against the agents table.
 * Attaches the matching agent to `request.agent` on success.
 * Responds with 401 Unauthorized if the token is missing, malformed, or not found.
 * @param pool - The PostgreSQL connection pool to query agents from.
 * @returns An Express RequestHandler.
 */
export function authenticateAgent(pool: Pool): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const token = extractApiKey(request.headers.authorization);

    if (token === null) {
      response.status(401).json({ error: "Unauthorised" });
      return;
    }

    const hash = hashApiKey(token);

    try {
      const result = await pool.query<{ id: string; name: string }>(
        AGENT_LOOKUP_SQL,
        [hash],
      );

      if (result.rows.length === 0) {
        response.status(401).json({ error: "Invalid API key" });
        return;
      }

      request.agent = result.rows[0] as { id: string; name: string };
      next();
    } catch (error) {
      next(error);
    }
  };
}
