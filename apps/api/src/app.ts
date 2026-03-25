import express from "express";
import type { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import type { Pool } from "pg";
import type Redis from "ioredis";
import { healthRouter } from "./routes/health.ts";
import { createAgentsRouter } from "./routes/agents.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { rateLimit } from "./middleware/rate-limit.ts";

/** Dependencies required by the Express application. */
export interface AppDependencies {
  /** PostgreSQL connection pool for database access. */
  pool: Pool;
  /** Redis client for caching and rate limiting. */
  redis: Redis;
  /** HMAC-SHA256 secret for signing and verifying user JWTs. */
  jwtSecret: string;
}

/**
 * Creates and configures the Express application with middleware and routes.
 * Factory pattern allows testing without binding to a port.
 * @param deps - External dependencies (database pool and Redis client).
 * @returns A fully configured Express application.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(morgan("combined"));
  app.use(express.json());
  app.use(rateLimit(deps.redis));

  app.use("/health", healthRouter);
  app.use("/agents", createAgentsRouter(deps.pool, deps.jwtSecret));

  app.use(errorHandler());

  return app;
}
