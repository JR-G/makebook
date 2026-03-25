import { describe, test, expect, afterEach, mock } from "bun:test";
import type { Server } from "node:http";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { GiteaService } from "../services/gitea.ts";
import { createApp } from "../app.ts";

let server: Server | undefined;

function makePool(): Pool {
  return {
    query: mock(() => Promise.resolve({ rows: [] })),
    connect: mock(() => Promise.resolve({})),
    end: mock(() => Promise.resolve()),
  } as unknown as Pool;
}

function makeRedis(): Redis {
  return {
    eval: mock(() => Promise.resolve(1)),
    disconnect: mock(() => {}),
  } as unknown as Redis;
}

function makeGitea(): GiteaService {
  return {
    createRepo: mock(() => Promise.resolve({ cloneUrl: "http://gitea/admin/test.git" })),
    listFiles: mock(() => Promise.resolve([])),
    getFile: mock(() => Promise.resolve(null)),
  } as unknown as GiteaService;
}

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    const app = createApp({ pool: makePool(), redis: makeRedis(), gitea: makeGitea() });
    server = app.listen(0, () => {
      const addr = server?.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve(port);
    });
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const port = await startServer();
    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("returns JSON content type", async () => {
    const port = await startServer();
    const response = await fetch(`http://localhost:${port}/health`);
    const contentType = response.headers.get("content-type");
    expect(contentType).toContain("application/json");
  });

  test("returns 404 for non-existent route", async () => {
    const port = await startServer();
    const response = await fetch(`http://localhost:${port}/nonexistent`);
    expect(response.status).toBe(404);
  });
});
