import { describe, test, expect, mock } from "bun:test";
import type { Pool, QueryResult } from "pg";
import type { GiteaService } from "./gitea.ts";
import { ProjectService } from "./project.ts";

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

/** Builds a minimal AgentRow for collaborator queries. */
function makeAgentRow(overrides: Partial<{ id: string; name: string; created_at: Date }> = {}) {
  return {
    id: overrides.id ?? "agent-1",
    name: overrides.name ?? "Test Agent",
    created_at: overrides.created_at ?? NOW,
  };
}

/** Creates a pool mock with a sequence of query responses. */
function makePool(responses: QueryResult[]): Pool {
  let callIndex = 0;
  return {
    query: mock(() => {
      const result = responses[callIndex++] ?? { rows: [], rowCount: 0 };
      return Promise.resolve(result);
    }),
  } as unknown as Pool;
}

/** Creates a GiteaService mock. */
function makeGitea(cloneUrl = "http://gitea/admin/test-project.git"): GiteaService {
  return {
    createRepo: mock(() => Promise.resolve({ cloneUrl })),
    listFiles: mock(() => Promise.resolve([])),
    getFile: mock(() => Promise.resolve(null)),
  } as unknown as GiteaService;
}

describe("ProjectService", () => {
  describe("create", () => {
    test("creates a project with the correct slug derived from name", async () => {
      const projectRow = makeProjectRow({ slug: "hello-world" });
      const pool = makePool([
        { rows: [], rowCount: 0 } as unknown as QueryResult,
        { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const project = await service.create("agent-1", { name: "Hello World" });

      expect(project.slug).toBe("hello-world");
      expect(project.name).toBe("Test Project");
    });

    test("calls GiteaService.createRepo with the slug", async () => {
      const projectRow = makeProjectRow();
      const pool = makePool([
        { rows: [], rowCount: 0 } as unknown as QueryResult,
        { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      await service.create("agent-1", { name: "Test Project" });

      expect(gitea.createRepo).toHaveBeenCalledTimes(1);
    });

    test("adds the creator as a collaborator automatically", async () => {
      const projectRow = makeProjectRow();
      const queryCalls: string[] = [];
      const pool = {
        query: mock((sql: string) => {
          queryCalls.push(sql.trim().split("\n")[0]?.trim() ?? "");
          if (queryCalls.length === 2) {
            return Promise.resolve({ rows: [projectRow], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      } as unknown as Pool;
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      await service.create("agent-1", { name: "Test Project" });

      const collaboratorInsert = queryCalls.find((sql) =>
        sql.includes("INSERT INTO collaborators"),
      );
      expect(collaboratorInsert).toBeDefined();
    });

    test("appends a 4-character hex suffix when the slug already exists", async () => {
      const collisionRow = makeProjectRow({ id: "other-proj" });
      const newRow = makeProjectRow({ slug: "test-project-ab12" });
      const pool = makePool([
        { rows: [collisionRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [newRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const project = await service.create("agent-1", { name: "Test Project" });

      expect(project.slug).toMatch(/^test-project-[0-9a-f]{4}$/);
    });

    test("throws 400 for an empty name", async () => {
      const pool = makePool([]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      try {
        await service.create("agent-1", { name: "" });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ statusCode: 400 });
      }
    });

    test("throws 400 for a whitespace-only name", async () => {
      const pool = makePool([]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      try {
        await service.create("agent-1", { name: "   " });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ statusCode: 400 });
      }
    });
  });

  describe("getWithCollaborators", () => {
    test("returns project with collaborators array, build count, and latest build", async () => {
      const projectRow = makeProjectRow();
      const agentRow = makeAgentRow();
      const pool = makePool([
        { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [agentRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [{ build_count: "3" }], rowCount: 1 } as unknown as QueryResult,
        {
          rows: [{ id: "contrib-1", status: "success", created_at: NOW }],
          rowCount: 1,
        } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const result = await service.getWithCollaborators("proj-1");

      expect(result).not.toBeNull();
      expect(result?.collaborators).toHaveLength(1);
      expect(result?.buildCount).toBe(3);
      expect(result?.latestBuild?.id).toBe("contrib-1");
      expect(result?.latestBuild?.status).toBe("success");
    });

    test("returns null for a non-existent project", async () => {
      const pool = makePool([
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const result = await service.getWithCollaborators("nonexistent-id");

      expect(result).toBeNull();
    });

    test("returns latestBuild as null when no non-pending contributions exist", async () => {
      const projectRow = makeProjectRow();
      const pool = makePool([
        { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [], rowCount: 0 } as unknown as QueryResult,
        { rows: [{ build_count: "0" }], rowCount: 1 } as unknown as QueryResult,
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const result = await service.getWithCollaborators("proj-1");

      expect(result?.latestBuild).toBeNull();
      expect(result?.buildCount).toBe(0);
    });
  });

  describe("list", () => {
    test("returns paginated results with default page and pageSize", async () => {
      const projectRow = makeProjectRow();
      const pool = makePool([
        { rows: [projectRow], rowCount: 1 } as unknown as QueryResult,
        { rows: [{ count: "1" }], rowCount: 1 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const result = await service.list();

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    test("filters results by status when status is provided", async () => {
      const capturedSQLs: string[] = [];
      const pool = {
        query: mock((sql: string) => {
          capturedSQLs.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      } as unknown as Pool;
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      await service.list({ status: "open" });

      const selectSQL = capturedSQLs[0] ?? "";
      expect(selectSQL).toContain("WHERE status");
    });

    test("returns empty items when no projects match", async () => {
      const pool = makePool([
        { rows: [], rowCount: 0 } as unknown as QueryResult,
        { rows: [{ count: "0" }], rowCount: 1 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const result = await service.list({ status: "archived" });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe("join", () => {
    test("inserts a collaborator row", async () => {
      const insertedSQLs: string[] = [];
      const pool = {
        query: mock((sql: string) => {
          insertedSQLs.push(sql.trim());
          if (sql.includes("SELECT status")) {
            return Promise.resolve({ rows: [{ status: "open" }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        }),
      } as unknown as Pool;
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      await service.join("proj-1", "agent-2");

      const collaboratorInsert = insertedSQLs.find((sql) =>
        sql.includes("INSERT INTO collaborators"),
      );
      expect(collaboratorInsert).toBeDefined();
    });

    test("silently no-ops on duplicate join via ON CONFLICT DO NOTHING", async () => {
      const pool = makePool([
        { rows: [{ status: "open" }], rowCount: 1 } as unknown as QueryResult,
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const result = await service.join("proj-1", "agent-1");
      expect(result).toBeUndefined();
    });

    test("throws 404 for a non-existent project", async () => {
      const pool = makePool([
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      try {
        await service.join("nonexistent", "agent-1");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ statusCode: 404 });
      }
    });

    test("throws 400 when the project is archived", async () => {
      const pool = makePool([
        { rows: [{ status: "archived" }], rowCount: 1 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      try {
        await service.join("proj-1", "agent-1");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ statusCode: 400 });
      }
    });
  });

  describe("leave", () => {
    test("removes the collaborator row", async () => {
      const deletedSQLs: string[] = [];
      const pool = {
        query: mock((sql: string) => {
          deletedSQLs.push(sql.trim());
          if (sql.includes("SELECT creator_id")) {
            return Promise.resolve({
              rows: [{ creator_id: "creator-agent" }],
              rowCount: 1,
            });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        }),
      } as unknown as Pool;
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      await service.leave("proj-1", "agent-2");

      const deleteSQL = deletedSQLs.find((sql) =>
        sql.includes("DELETE FROM collaborators"),
      );
      expect(deleteSQL).toBeDefined();
    });

    test("throws 400 when the creator attempts to leave their own project", async () => {
      const pool = makePool([
        { rows: [{ creator_id: "agent-1" }], rowCount: 1 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      try {
        await service.leave("proj-1", "agent-1");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ statusCode: 400 });
      }
    });
  });

  describe("listByAgent", () => {
    test("returns projects the agent has joined as a collaborator", async () => {
      const row1 = makeProjectRow({ id: "proj-1", slug: "project-one" });
      const row2 = makeProjectRow({ id: "proj-2", slug: "project-two" });
      const pool = makePool([
        { rows: [row1, row2], rowCount: 2 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const projects = await service.listByAgent("agent-1");

      expect(projects).toHaveLength(2);
    });

    test("returns an empty array when the agent has not joined any projects", async () => {
      const pool = makePool([
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const gitea = makeGitea();
      const service = new ProjectService(pool, gitea);

      const projects = await service.listByAgent("agent-1");

      expect(projects).toHaveLength(0);
    });
  });
});
