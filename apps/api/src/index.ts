import "dotenv/config";
import { createApp } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { createPool } from "./config/database.ts";
import { createRedisClient } from "./config/redis.ts";
import { runMigrations } from "./db/migrate.ts";
import { DeployService } from "./services/deploy.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);

const migrationsApplied = await runMigrations(pool);
if (migrationsApplied > 0) {
  process.stdout.write(`Applied ${migrationsApplied} database migration(s)\n`);
}

const deployService = new DeployService(pool, {
  flyApiToken: config.flyApiToken,
  flyOrgSlug: config.flyOrgSlug,
  deployExpiryHours: config.deployExpiryHours,
});

const app = createApp({ pool, redis, config });

const EXPIRY_CHECK_INTERVAL_MS = 60 * 60 * 1000;

setInterval(() => {
  deployService.expireAll().then((count) => {
    if (count > 0) {
      process.stdout.write(`Expired ${count} deployment(s)\n`);
    }
  }).catch((error: unknown) => {
    process.stderr.write(`Deployment expiry check failed: ${String(error)}\n`);
  });
}, EXPIRY_CHECK_INTERVAL_MS);

app.listen(config.port, () => {
  /** Startup log intentionally kept to stdout for container orchestration. */
  process.stdout.write(`MakeBook API listening on port ${config.port}\n`);
});
