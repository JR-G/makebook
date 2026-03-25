import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "./index.ts";

const validEnv = {
  PORT: "3000",
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://makebook:makebook@localhost:5432/makebook",
  REDIS_URL: "redis://localhost:6379",
  GITEA_URL: "http://localhost:3001",
  GITEA_ADMIN_TOKEN: "test-admin-token",
  JWT_SECRET: "test-secret-that-is-long-enough",
};

describe("loadConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const [key, value] of Object.entries(validEnv)) {
      process.env[key] = value;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("parses valid environment variables", () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe("development");
    expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(config.redisUrl).toBe(validEnv.REDIS_URL);
    expect(config.giteaUrl).toBe(validEnv.GITEA_URL);
    expect(config.giteaAdminToken).toBe(validEnv.GITEA_ADMIN_TOKEN);
    expect(config.jwtSecret).toBe(validEnv.JWT_SECRET);
  });

  test("defaults port to 3000 when not provided", () => {
    delete process.env["PORT"];
    const config = loadConfig();
    expect(config.port).toBe(3000);
  });

  test("defaults nodeEnv to development when not provided", () => {
    delete process.env.NODE_ENV;
    const config = loadConfig();
    expect(config.nodeEnv).toBe("development");
  });

  test("throws on missing DATABASE_URL", () => {
    delete process.env["DATABASE_URL"];
    expect(() => loadConfig()).toThrow();
  });

  test("throws on missing REDIS_URL", () => {
    delete process.env["REDIS_URL"];
    expect(() => loadConfig()).toThrow();
  });

  test("throws on missing GITEA_URL", () => {
    delete process.env["GITEA_URL"];
    expect(() => loadConfig()).toThrow();
  });

  test("throws on missing GITEA_ADMIN_TOKEN", () => {
    delete process.env["GITEA_ADMIN_TOKEN"];
    expect(() => loadConfig()).toThrow();
  });

  test("throws on missing JWT_SECRET", () => {
    delete process.env["JWT_SECRET"];
    expect(() => loadConfig()).toThrow();
  });

  test("throws on invalid port value", () => {
    process.env["PORT"] = "not-a-number";
    expect(() => loadConfig()).toThrow();
  });

  test("throws on invalid NODE_ENV value", () => {
    process.env.NODE_ENV = "invalid-env";
    expect(() => loadConfig()).toThrow();
  });

  test("throws on invalid DATABASE_URL format", () => {
    process.env["DATABASE_URL"] = "not-a-url";
    expect(() => loadConfig()).toThrow();
  });

  test("throws on empty JWT_SECRET (too short)", () => {
    process.env["JWT_SECRET"] = "short";
    expect(() => loadConfig()).toThrow();
  });

  test("optional fields default to empty string when not provided", () => {
    const config = loadConfig();
    expect(config.e2bApiKey).toBe("");
    expect(config.flyApiToken).toBe("");
    expect(config.githubClientId).toBe("");
    expect(config.githubClientSecret).toBe("");
  });

  test("flyOrgSlug defaults to 'makebook' when not provided", () => {
    const config = loadConfig();
    expect(config.flyOrgSlug).toBe("makebook");
  });

  test("sharedPoolMaxSandboxHours defaults to 10", () => {
    const config = loadConfig();
    expect(config.sharedPoolMaxSandboxHours).toBe(10);
  });

  test("sharedPoolMaxConcurrent defaults to 5", () => {
    const config = loadConfig();
    expect(config.sharedPoolMaxConcurrent).toBe(5);
  });

  test("sharedPoolMaxDeployed defaults to 30", () => {
    const config = loadConfig();
    expect(config.sharedPoolMaxDeployed).toBe(30);
  });

  test("sharedPoolDeployExpiryHours defaults to 48", () => {
    const config = loadConfig();
    expect(config.sharedPoolDeployExpiryHours).toBe(48);
  });

  test("sharedPoolMaxBuildsPerAgent defaults to 5", () => {
    const config = loadConfig();
    expect(config.sharedPoolMaxBuildsPerAgent).toBe(5);
  });

  test("parses numeric optional fields from environment variables", () => {
    process.env["SHARED_POOL_MAX_SANDBOX_HOURS"] = "20";
    process.env["SHARED_POOL_MAX_CONCURRENT"] = "10";
    const config = loadConfig();
    expect(config.sharedPoolMaxSandboxHours).toBe(20);
    expect(config.sharedPoolMaxConcurrent).toBe(10);
  });
});
