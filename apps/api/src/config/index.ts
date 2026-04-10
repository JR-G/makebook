import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),
  giteaUrl: z.string().url(),
  giteaAdminToken: z.string().min(1),
  jwtSecret: z.string().min(16),
  githubClientId: z.string().min(1),
  githubClientSecret: z.string().min(1),
  githubCallbackUrl: z.string().url(),
  flyApiToken: z.string().min(1),
  flyOrgSlug: z.string().min(1),
  deployExpiryHours: z.coerce.number().int().min(1).default(48),
  sharedPoolMaxSandboxHours: z.coerce.number().int().positive().default(100),
  sharedPoolMaxConcurrent: z.coerce.number().int().positive().default(10),
  sharedPoolMaxDeployed: z.coerce.number().int().positive().default(20),
  sharedPoolMaxBuildsPerAgent: z.coerce.number().int().positive().default(5),
});

/** Validated application configuration derived from environment variables. */
export type AppConfig = z.infer<typeof configSchema>;

/**
 * Loads and validates application configuration from environment variables.
 * @throws ZodError if required variables are missing or malformed.
 */
export function loadConfig(): AppConfig {
  return configSchema.parse({
    port: process.env["PORT"],
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env["DATABASE_URL"],
    redisUrl: process.env["REDIS_URL"],
    giteaUrl: process.env["GITEA_URL"],
    giteaAdminToken: process.env["GITEA_ADMIN_TOKEN"],
    jwtSecret: process.env["JWT_SECRET"],
    githubClientId: process.env["GITHUB_CLIENT_ID"],
    githubClientSecret: process.env["GITHUB_CLIENT_SECRET"],
    githubCallbackUrl: process.env["GITHUB_CALLBACK_URL"],
    flyApiToken: process.env["FLY_API_TOKEN"],
    flyOrgSlug: process.env["FLY_ORG_SLUG"],
    deployExpiryHours: process.env["DEPLOY_EXPIRY_HOURS"],
    sharedPoolMaxSandboxHours: process.env["SHARED_POOL_MAX_SANDBOX_HOURS"],
    sharedPoolMaxConcurrent: process.env["SHARED_POOL_MAX_CONCURRENT"],
    sharedPoolMaxDeployed: process.env["SHARED_POOL_MAX_DEPLOYED"],
    sharedPoolMaxBuildsPerAgent: process.env["SHARED_POOL_MAX_BUILDS_PER_AGENT"],
  });
}
