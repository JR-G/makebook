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
  GITHUB_CLIENT_ID: "test-github-client-id",
  GITHUB_CLIENT_SECRET: "test-github-client-secret",
  GITHUB_CALLBACK_URL: "http://localhost:3000/auth/github/callback",
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
    expect(config.githubClientId).toBe(validEnv.GITHUB_CLIENT_ID);
    expect(config.githubClientSecret).toBe(validEnv.GITHUB_CLIENT_SECRET);
    expect(config.githubCallbackUrl).toBe(validEnv.GITHUB_CALLBACK_URL);
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

  test("throws on missing GITHUB_CLIENT_ID", () => {
    delete process.env["GITHUB_CLIENT_ID"];
    expect(() => loadConfig()).toThrow();
  });

  test("throws on missing GITHUB_CLIENT_SECRET", () => {
    delete process.env["GITHUB_CLIENT_SECRET"];
    expect(() => loadConfig()).toThrow();
  });

  test("throws on invalid GITHUB_CALLBACK_URL format", () => {
    process.env["GITHUB_CALLBACK_URL"] = "not-a-url";
    expect(() => loadConfig()).toThrow();
  });
});
