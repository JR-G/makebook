import { describe, test, expect, afterEach, mock } from "bun:test";
import type { Server } from "node:http";
import type { Pool, QueryResult } from "pg";
import type Redis from "ioredis";
import type { GiteaService } from "../services/gitea.ts";
import { createApp } from "../app.ts";

let server: Server | undefined;

const NOW = new Date("2026-03-25T10:00:00.000Z");

/** Builds a minimal ProjectRow for use in mock query results. */
function makeProjectRow(overrides: Partial<{
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creator_id: string;
  gitea_repo: string;
  status: string;
  deploy_tier: string;
  created_at: Date;
  updated_at: Date;
}> = {}) {
  return {
    id: overrides.id ?? "proj-1",
    name: overrides.name ?? "Test Project",
    slug: overrides.slug ?? "test-project",
    description: overrides.description ?? null,
    creator_id: overrides.creator_id ?? "agent-1",
    gitea_repo: overrides.gitea_repo ?? "http://gitea/admin/test-project.git",
    status: overrides.status ?? "open",
    deploy_tier: overrides.deploy_tier ?? "shared",
    created_at: overrides.created_at ?? NOW,
    updated_at: overrides.updated_at ?? NOW,
  };
}

/**
 * Creates a pool mock that:
 * - Returns an active agent for API key validation (first query for each request).
 * - Returns the provided responses for subsequent queries.
 */
function makePool(agentId: string, queryResponses: QueryResult[]): Pool {
  const agentRow = { id: agentId, name: "Test Agent" };
  const queue = [
    { rows: [agentRow], rowCount: 1 } as unknown as QueryResult,
    ...queryResponses,
  ];
  let callIndex = 0;
  return {
    query: mock(() => {
      const result = queue[callIndex++] ?? { rows: [], rowCount: 0 };
      return Promise.resolve(result);
    }),
  } as unknown as Pool;
}

/** Creates a pool mock for unauthenticated (public) routes (no agent lookup needed). */
function makePublicPool(queryResponses: QueryResult[]): Pool {
  let callIndex = 0;
  return {
    query: mock(() => {
      const result = queryResponses[callIndex++] ?? { rows: [], rowCount: 0 };
      return Promise.resolve(result);
    }),
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
    createRepo: mock(() =>
      Promise.resolve({ cloneUrl: "http://gitea/admin/test-project.git" }),
    ),
    listFiles: mock(() =>
      Promise.resolve([{ name: "README.md", path: "README.md", type: "file", size: 42, sha: "abc" }]),
    ),
    getFile: mock(() =>
      Promise.resolve({ content: "# Hello", sha: "abc123" }),
    ),
  } as unknown as GiteaService;
}

function startServer(pool: Pool, gitea: GiteaService = makeGitea()): Promise<number> {
  return new Promise((resolve) => {
    const app = createApp({ pool, redis: makeRedis(), gitea });
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

describe("POST /projects", () => {
  test("returns 201 with created project when authenticated", async () => {
    const projectRow = makeProjectRow();
    const pool = makePool("agent-1", [
      { rows: [], rowCount: 0 } as unknown as QueryResult,
      { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 0 } as unknown as QueryResult,
    ]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer mk_testkey",
      },
      body: JSON.stringify({ name: "Test Project" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { success: boolean; data: { name: string } };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Test Project");
  });

  test("returns 401 when no Authorization header is provided", async () => {
    const pool = makePublicPool([]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Project" }),
    });

    expect(response.status).toBe(401);
  });

  test("returns 400 when name is empty", async () => {
    const pool = makePool("agent-1", []);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer mk_testkey",
      },
      body: JSON.stringify({ name: "" }),
    });

    expect(response.status).toBe(400);
  });
});

describe("GET /projects", () => {
  test("returns paginated list of projects", async () => {
    const projectRow = makeProjectRow();
    const pool = makePublicPool([
      { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
      { rows: [{ count: "1" }], rowCount: 1 } as unknown as QueryResult,
    ]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { items: unknown[]; total: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.total).toBe(1);
  });
});

describe("GET /projects/:idOrSlug", () => {
  test("returns project by UUID", async () => {
    const projectRow = makeProjectRow({ id: "11111111-1111-1111-1111-111111111111" });
    const pool = makePublicPool([
      { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 0 } as unknown as QueryResult,
      { rows: [{ build_count: "0" }], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 0 } as unknown as QueryResult,
    ]);
    const port = await startServer(pool);

    const response = await fetch(
      `http://localhost:${port}/projects/11111111-1111-1111-1111-111111111111`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("11111111-1111-1111-1111-111111111111");
  });

  test("returns project by slug", async () => {
    const projectRow = makeProjectRow({ slug: "my-project" });
    const pool = makePublicPool([
      { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
      { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 0 } as unknown as QueryResult,
      { rows: [{ build_count: "0" }], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 0 } as unknown as QueryResult,
    ]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects/my-project`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; data: { slug: string } };
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe("my-project");
  });

  test("returns 404 for a non-existent project", async () => {
    const pool = makePublicPool([
      { rows: [], rowCount: 0 } as unknown as QueryResult,
    ]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects/no-such-project`);

    expect(response.status).toBe(404);
  });
});

describe("POST /projects/:id/join", () => {
  test("returns 200 on successful join", async () => {
    const pool = makePool("agent-2", [
      { rows: [{ status: "open" }], rowCount: 1 } as unknown as QueryResult,
      { rows: [], rowCount: 1 } as unknown as QueryResult,
    ]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects/proj-1/join`, {
      method: "POST",
      headers: { Authorization: "Bearer mk_testkey" },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  test("returns 401 without Authorization header", async () => {
    const pool = makePublicPool([]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects/proj-1/join`, {
      method: "POST",
    });

    expect(response.status).toBe(401);
  });
});

describe("GET /projects/:id/files", () => {
  test("returns file listing from Gitea", async () => {
    const projectRow = makeProjectRow();
    const pool = makePublicPool([
      { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
    ]);
    const port = await startServer(pool);

    const response = await fetch(`http://localhost:${port}/projects/proj-1/files`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: { name: string }[];
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe("README.md");
  });
});
