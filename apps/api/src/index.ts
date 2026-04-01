import "dotenv/config";
import { createApp } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { createPool } from "./config/database.ts";
import { createRedisClient } from "./config/redis.ts";
import { runMigrations } from "./db/migrate.ts";
import { InfraRouter } from "./services/infra-router.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);

const migrationsApplied = await runMigrations(pool);
if (migrationsApplied > 0) {
  process.stdout.write(`Applied ${migrationsApplied} database migration(s)\n`);
}

const infraRouter = new InfraRouter(pool, {
  sharedPoolMaxSandboxHours: Number(process.env["SHARED_POOL_MAX_SANDBOX_HOURS"] ?? "100"),
  sharedPoolMaxConcurrent: Number(process.env["SHARED_POOL_MAX_CONCURRENT"] ?? "10"),
  sharedPoolMaxDeployed: Number(process.env["SHARED_POOL_MAX_DEPLOYED"] ?? "20"),
  sharedPoolMaxBuildsPerAgent: Number(process.env["SHARED_POOL_MAX_BUILDS_PER_AGENT"] ?? "5"),
  e2bApiKey: process.env["E2B_API_KEY"] ?? "",
});

const app = createApp({ pool, redis, config, infraRouter });

app.listen(config.port, () => {
  /** Startup log intentionally kept to stdout for container orchestration. */
  process.stdout.write(`MakeBook API listening on port ${config.port}\n`);
});
