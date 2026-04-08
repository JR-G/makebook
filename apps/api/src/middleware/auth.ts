import type { RequestHandler } from "express";
import type { Pool } from "pg";
import jwt from "jsonwebtoken";
import { extractApiKey, hashApiKey } from "@makebook/auth";
import type { Agent, User } from "@makebook/types";
import type { AppConfig } from "../config/index.ts";

const AGENT_LOOKUP_SQL =
  "SELECT * FROM agents WHERE api_key_hash = $1 AND status = 'active' LIMIT 1";

const USER_LOOKUP_SQL = "SELECT * FROM users WHERE id = $1 LIMIT 1";

/** JWT payload shape issued during GitHub OAuth. */
interface JwtPayload {
  userId: string;
  username: string;
}

function isJwtPayload(value: unknown): value is JwtPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    "username" in value &&
    typeof (value as Record<string, unknown>)["userId"] === "string" &&
    typeof (value as Record<string, unknown>)["username"] === "string"
  );
}

/**
 * Middleware that requires a valid MakeBook API key in the Authorization header.
 *
 * @remarks
 * Extracts the Bearer token via {@link extractApiKey}, hashes it, and looks up
 * a matching active agent in the database. Sets `req.agent` on success.
 * Responds with `401` if the key is absent, malformed, or not found.
 *
 * @returns An Express RequestHandler.
 */
export function authenticateAgent(): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const key = extractApiKey(req.headers.authorization);

    if (key === null) {
      res
        .status(401)
        .json({ success: false, error: "Missing or invalid API key" });
      return;
    }

    const hash = hashApiKey(key);

    try {
      const pool = req.app.locals["pool"] as Pool;
      const result = await pool.query<Agent>(AGENT_LOOKUP_SQL, [hash]);
      const agent = result.rows.at(0);

      if (agent === undefined) {
        res.status(401).json({ success: false, error: "Invalid API key" });
        return;
      }

      req.agent = agent;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware that optionally authenticates a MakeBook API key.
 *
 * @remarks
 * Behaves like {@link authenticateAgent} when a Bearer token is present.
 * When no Authorization header is supplied it calls `next()` without setting
 * `req.agent`, allowing the request to proceed unauthenticated.
 * If a key IS present but fails validation it still responds with `401`.
 *
 * @returns An Express RequestHandler.
 */
export function optionalAgent(): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      next();
      return;
    }

    const key = extractApiKey(authHeader);

    if (key === null) {
      res
        .status(401)
        .json({ success: false, error: "Missing or invalid API key" });
      return;
    }

    const hash = hashApiKey(key);

    try {
      const pool = req.app.locals["pool"] as Pool;
      const result = await pool.query<Agent>(AGENT_LOOKUP_SQL, [hash]);
      const agent = result.rows.at(0);

      if (agent === undefined) {
        res.status(401).json({ success: false, error: "Invalid API key" });
        return;
      }

      req.agent = agent;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware that requires a valid JWT issued by this service.
 *
 * @remarks
 * Extracts a Bearer token from the Authorization header, verifies the JWT
 * signature using the configured `jwtSecret`, then loads the matching user
 * from the database. Sets `req.user` on success. Responds with `401` for any
 * invalid, expired, or unrecognised token.
 *
 * @returns An Express RequestHandler.
 */
export function authenticateUser(): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
      return;
    }

    const token = authHeader.slice("Bearer ".length);

    try {
      const config = req.app.locals["config"] as AppConfig;
      const decoded = jwt.verify(token, config.jwtSecret);

      if (!isJwtPayload(decoded)) {
        res
          .status(401)
          .json({ success: false, error: "Invalid or expired token" });
        return;
      }

      const pool = req.app.locals["pool"] as Pool;
      const result = await pool.query<User>(USER_LOOKUP_SQL, [decoded.userId]);
      const user = result.rows.at(0);

      if (user === undefined) {
        res
          .status(401)
          .json({ success: false, error: "Invalid or expired token" });
        return;
      }

      req.user = user;
      next();
    } catch {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    }
  };
}
