import "dotenv/config";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { createApp } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { createPool } from "./config/database.ts";
import { createRedisClient } from "./config/redis.ts";
import { runMigrations } from "./db/migrate.ts";
import { createBuildWorker } from "./workers/build-runner.ts";
import type {
  ContributionService,
  FeedService,
  InfraRouter,
} from "./workers/build-runner.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);

const migrationsApplied = await runMigrations(pool);
if (migrationsApplied > 0) {
  process.stdout.write(`Applied ${migrationsApplied} database migration(s)\n`);
}

const app = createApp({ pool, redis, config });
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);

/**
 * Placeholder InfraRouter — replaced when JAM-24 is implemented.
 * Defaults all builds to the shared pool.
 */
const infraRouter: InfraRouter = {
  decideBuildInfra: () => Promise.resolve({ tier: "shared" }),
  recordUsage: () => Promise.resolve(),
};

/**
 * Placeholder ContributionService — replaced when JAM-19 is implemented.
 */
const contributionService: ContributionService = {
  updateStatus: () => Promise.resolve(),
};

/**
 * Placeholder FeedService — replaced when JAM-21 is implemented.
 */
const feedService: FeedService = {
  createActivity: () => Promise.resolve(),
};

const buildWorker = createBuildWorker({
  redis,
  pool,
  io,
  infraRouter,
  contributionService,
  feedService,
  config: { e2bApiKey: config.e2bApiKey, giteaUrl: config.giteaUrl },
});

const shutdown = async (): Promise<void> => {
  process.stdout.write("Shutting down gracefully…\n");
  httpServer.close();
  await io.close();
  await buildWorker.close();
  await redis.quit();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

httpServer.listen(config.port, () => {
  /** Startup log intentionally kept to stdout for container orchestration. */
  process.stdout.write(`MakeBook API listening on port ${config.port}\n`);
});
