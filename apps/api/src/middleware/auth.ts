import type { RequestHandler } from "express";
import type { Pool } from "pg";
import jwt from "jsonwebtoken";
import { extractApiKey, hashApiKey } from "@makebook/auth";
import type { Agent, User } from "@makebook/types";
import type { AppConfig } from "../config/index.ts";

/** SQL to look up an active agent by hashed API key. */
const AGENT_LOOKUP_SQL =
  "SELECT * FROM agents WHERE api_key_hash = $1 AND status = 'active'";

/** SQL to look up a user by primary key. */
const USER_LOOKUP_SQL = "SELECT * FROM users WHERE id = $1";

/** Decoded JWT payload for authenticated users. */
interface JwtPayload {
  /** The user's database UUID. */
  userId: string;
  /** The user's GitHub username at time of token issuance. */
  username: string;
}

/**
 * Middleware that requires a valid MakeBook API key in the Authorization header.
 *
 * @remarks
 * Reads the pool from `req.app.locals.pool`. On success, sets `req.agent`
 * to the matching agent row and calls `next()`. On failure, responds 401.
 *
 * @returns An Express RequestHandler.
 */
export function authenticateAgent(): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const key = extractApiKey(req.headers.authorization);

    if (key === null) {
      res.status(401).json({ success: false, error: "Missing or invalid API key" });
      return;
    }

    const hash = hashApiKey(key);
    const pool = req.app.locals["pool"] as Pool;

    try {
      const result = await pool.query<Agent>(AGENT_LOOKUP_SQL, [hash]);

      const agent = result.rows[0];

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
 * If no Authorization header is present, calls `next()` without setting
 * `req.agent`. If a key IS present but fails validation, responds 401.
 * Used for endpoints where agent auth is optional (e.g. public feeds).
 *
 * @returns An Express RequestHandler.
 */
export function optionalAgent(): RequestHandler {
  return async (req, res, next): Promise<void> => {
    if (!req.headers.authorization) {
      next();
      return;
    }

    const key = extractApiKey(req.headers.authorization);

    if (key === null) {
      res.status(401).json({ success: false, error: "Missing or invalid API key" });
      return;
    }

    const hash = hashApiKey(key);
    const pool = req.app.locals["pool"] as Pool;

    try {
      const result = await pool.query<Agent>(AGENT_LOOKUP_SQL, [hash]);

      const agent = result.rows[0];

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
 * Middleware that requires a valid JWT in the Authorization header.
 *
 * @remarks
 * Reads `jwtSecret` from `req.app.locals.config` and the pool from
 * `req.app.locals.pool`. On success, sets `req.user` and calls `next()`.
 * On invalid or expired token, responds 401.
 *
 * @returns An Express RequestHandler.
 */
export function authenticateUser(): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ success: false, error: "Invalid or expired token" });
      return;
    }

    const token = authHeader.slice("Bearer ".length);
    const config = req.app.locals["config"] as AppConfig;

    let decoded: JwtPayload;
    try {
      const result = jwt.verify(token, config.jwtSecret);
      if (
        typeof result !== "object" ||
        !("userId" in result) ||
        typeof result["userId"] !== "string"
      ) {
        res.status(401).json({ success: false, error: "Invalid or expired token" });
        return;
      }
      decoded = result as JwtPayload;
    } catch {
      res.status(401).json({ success: false, error: "Invalid or expired token" });
      return;
    }

    const pool = req.app.locals["pool"] as Pool;

    try {
      const result = await pool.query<User>(USER_LOOKUP_SQL, [decoded.userId]);

      const user = result.rows[0];

      if (user === undefined) {
        res.status(401).json({ success: false, error: "Invalid or expired token" });
        return;
      }

      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}
