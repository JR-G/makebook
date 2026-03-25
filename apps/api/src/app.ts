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
import { createErrorHandler } from "./middleware/error-handler.ts";
import { createRateLimiter } from "./middleware/rate-limit.ts";

/** Optional dependencies that can be injected into the Express application. */
export interface AppOptions {
  /** PostgreSQL connection pool for database access. */
  pool?: Pool;
  /** Redis client for caching and rate limiting. */
  redis?: Redis;
  /** Validated application configuration. */
  config?: AppConfig;
}

/**
 * Creates and configures the Express application with middleware and routes.
 * Factory pattern allows testing without binding to a port.
 * Pool and Redis are optional — omitting them disables DB/cache middleware,
 * which is useful for unit tests that do not require external connections.
 * @param options - Optional external dependencies.
 * @returns A fully configured Express application.
 */
export function createApp(options: AppOptions = {}): Express {
  const { pool, redis, config } = options;
  const nodeEnv = config?.nodeEnv ?? "production";

  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(morgan("combined"));
  app.use(express.json());

  if (redis) {
    app.use(createRateLimiter(redis));
  }

  app.locals["pool"] = pool;
  app.locals["redis"] = redis;

  app.use("/health", healthRouter);

  app.use(createErrorHandler(nodeEnv));

  return app;
}
