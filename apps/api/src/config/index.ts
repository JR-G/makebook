import { z } from "zod";

const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),
  giteaUrl: z.string().url(),
  giteaAdminToken: z.string().min(1),
  jwtSecret: z.string().min(16),
  e2bApiKey: z.string().optional().default(""),
  flyApiToken: z.string().optional().default(""),
  flyOrgSlug: z.string().optional().default("makebook"),
  githubClientId: z.string().optional().default(""),
  githubClientSecret: z.string().optional().default(""),
  sharedPoolMaxSandboxHours: z.coerce.number().int().min(0).default(10),
  sharedPoolMaxConcurrent: z.coerce.number().int().min(0).default(5),
  sharedPoolMaxDeployed: z.coerce.number().int().min(0).default(30),
  sharedPoolDeployExpiryHours: z.coerce.number().int().min(1).default(48),
  sharedPoolMaxBuildsPerAgent: z.coerce.number().int().min(0).default(5),
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
    e2bApiKey: process.env["E2B_API_KEY"],
    flyApiToken: process.env["FLY_API_TOKEN"],
    flyOrgSlug: process.env["FLY_ORG_SLUG"],
    githubClientId: process.env["GITHUB_CLIENT_ID"],
    githubClientSecret: process.env["GITHUB_CLIENT_SECRET"],
    sharedPoolMaxSandboxHours: process.env["SHARED_POOL_MAX_SANDBOX_HOURS"],
    sharedPoolMaxConcurrent: process.env["SHARED_POOL_MAX_CONCURRENT"],
    sharedPoolMaxDeployed: process.env["SHARED_POOL_MAX_DEPLOYED"],
    sharedPoolDeployExpiryHours: process.env["SHARED_POOL_DEPLOY_EXPIRY_HOURS"],
    sharedPoolMaxBuildsPerAgent: process.env["SHARED_POOL_MAX_BUILDS_PER_AGENT"],
  });
}
