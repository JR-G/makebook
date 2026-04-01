import "dotenv/config";
import { createApp } from "./app.ts";
import { loadConfig } from "./config/index.ts";
import { createPool } from "./config/database.ts";
import { createRedisClient } from "./config/redis.ts";
import { runMigrations } from "./db/migrate.ts";
import { DeployService } from "./services/deploy.ts";
import { InfraRouter } from "./services/infra-router.ts";

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

const infraRouter = new InfraRouter(pool, {
  sharedPoolMaxSandboxHours: config.sharedPoolMaxSandboxHours,
  sharedPoolMaxConcurrent: config.sharedPoolMaxConcurrent,
  sharedPoolMaxDeployed: config.sharedPoolMaxDeployed,
  sharedPoolMaxBuildsPerAgent: config.sharedPoolMaxBuildsPerAgent,
});

const app = createApp({ pool, redis, config, infraRouter });

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
