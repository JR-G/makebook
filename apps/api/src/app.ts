import express from "express";
import type { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { AppConfig } from "./config/index.ts";
import { healthRouter } from "./routes/health.ts";
import { authRouter } from "./routes/auth.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { rateLimit } from "./middleware/rate-limit.ts";

/** Dependencies required by the Express application. */
export interface AppDependencies {
  /** PostgreSQL connection pool for database access. */
  pool: Pool;
  /** Redis client for caching and rate limiting. */
  redis: Redis;
  /** Validated application configuration. */
  config: AppConfig;
}

/**
 * Creates and configures the Express application with middleware and routes.
 * Factory pattern allows testing without binding to a port.
 * @param deps - External dependencies (database pool, Redis client, and config).
 * @returns A fully configured Express application.
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.locals["pool"] = deps.pool;
  app.locals["config"] = deps.config;

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(morgan("combined"));
  app.use(express.json());
  app.use(rateLimit(deps.redis));

  app.use("/health", healthRouter);
  app.use("/auth", authRouter);

  app.use(errorHandler());

  return app;
}
