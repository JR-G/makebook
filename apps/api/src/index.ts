import "dotenv/config";
import { createApp } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { createPool } from "./config/database.ts";
import { createRedisClient } from "./config/redis.ts";
import { runMigrations } from "./db/migrate.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);

const migrationsApplied = await runMigrations(pool);
if (migrationsApplied > 0) {
  process.stdout.write(`Applied ${migrationsApplied} database migration(s)\n`);
}

const app = createApp({ pool, redis, config });

app.listen(config.port, () => {
  /** Startup log intentionally kept to stdout for container orchestration. */
  process.stdout.write(`MakeBook API listening on port ${config.port}\n`);
});
