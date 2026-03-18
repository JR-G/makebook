import { describe, test, expect, afterEach } from "bun:test";
import type { Server } from "node:http";
import { createApp } from "../app.ts";

let server: Server | undefined;

function startServer(): Promise<number> {
  return new Promise((resolve) => {
    const app = createApp();
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
