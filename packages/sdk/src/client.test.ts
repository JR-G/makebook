import { describe, it, expect, beforeEach, mock } from "bun:test";
import { MakeBookClient } from "./client.ts";
import type {
  AgentPublic,
  Project,
  ProjectWithCollaborators,
  Contribution,
  GiteaFileEntry,
  PaginatedResponse,
  ActivityWithDetails,
} from "@makebook/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "mk_test_key";
const DEFAULT_BASE_URL = "https://api.makebook.dev";
const CUSTOM_BASE_URL = "https://staging.makebook.dev";

/** Builds a minimal success ApiResponse envelope around `data`. */
function successResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Builds an error ApiResponse envelope. */
function errorResponse(error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

/** Asserts the last fetch call used the expected Authorization header. */
function expectAuthHeader(fetchMock: ReturnType<typeof mock>): void {
  const lastCall = fetchMock.mock.calls.at(-1);
  if (lastCall == null) throw new Error("fetch was not called");
  const [, init] = lastCall as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  expect(headers["Authorization"]).toBe(`Bearer ${TEST_API_KEY}`);
}

/** Returns the URL from the last fetch call. */
function lastUrl(fetchMock: ReturnType<typeof mock>): string {
  const lastCall = fetchMock.mock.calls.at(-1);
  if (lastCall == null) throw new Error("fetch was not called");
  return lastCall[0] as string;
}

/** Returns the parsed body from the last fetch call. */
function lastBody(fetchMock: ReturnType<typeof mock>): unknown {
  const lastCall = fetchMock.mock.calls.at(-1);
  if (lastCall == null) throw new Error("fetch was not called");
  const [, init] = lastCall as [string, RequestInit];
  return JSON.parse(init.body as string);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Dates serialise to ISO strings through JSON — the real API always returns strings
// for timestamp fields. We cast fixture types to silence TypeScript's Date vs string
// mismatch; the runtime values match what the SDK actually receives.
const agentFixture = {
  id: "agent-1",
  name: "Test Agent",
  description: null,
  llmProvider: "claude",
  status: "active" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
} as unknown as AgentPublic;

const projectFixture = {
  id: "project-1",
  name: "Test Project",
  slug: "test-project",
  description: null,
  creatorId: "agent-1",
  giteaRepo: "org/test-project",
  status: "open" as const,
  deployUrl: null,
  deployTier: "shared" as const,
  flyMachineId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
} as unknown as Project;

const contributionFixture = {
  id: "contribution-1",
  projectId: "project-1",
  agentId: "agent-1",
  commitSha: "abc123",
  status: "passed" as const,
  buildLog: null,
  files: [{ path: "src/index.ts", content: "export {};", action: "create" as const }],
  message: "initial commit",
  createdAt: "2026-01-01T00:00:00.000Z",
} as unknown as Contribution;

const fileEntriesFixture: GiteaFileEntry[] = [
  { name: "src", path: "src", type: "dir", size: 0 },
  { name: "README.md", path: "README.md", type: "file", size: 512 },
];

function paginatedOf<T>(items: T[]): PaginatedResponse<T> {
  return { items, total: items.length, page: 1, pageSize: 20, hasMore: false };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MakeBookClient", () => {
  let fetchMock: ReturnType<typeof mock>;
  let client: MakeBookClient;

  beforeEach(() => {
    fetchMock = mock(() => successResponse(null));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    client = new MakeBookClient({ apiKey: TEST_API_KEY });
  });

  // -------------------------------------------------------------------------
  // constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("sets default baseUrl when not provided", async () => {
      fetchMock.mockReturnValue(successResponse(agentFixture));
      await client.getMe();
      expect(lastUrl(fetchMock)).toStartWith(DEFAULT_BASE_URL);
    });

    it("uses custom baseUrl when provided", async () => {
      fetchMock.mockReturnValue(successResponse(agentFixture));
      const customClient = new MakeBookClient({
        apiKey: TEST_API_KEY,
        baseUrl: CUSTOM_BASE_URL,
      });
      await customClient.getMe();
      expect(lastUrl(fetchMock)).toStartWith(CUSTOM_BASE_URL);
    });
  });

  // -------------------------------------------------------------------------
  // request helper (tested indirectly through public methods)
  // -------------------------------------------------------------------------

  describe("request helper", () => {
    it("sends correct Authorization header", async () => {
      fetchMock.mockReturnValue(successResponse(agentFixture));
      await client.getMe();
      expectAuthHeader(fetchMock);
    });

    it("sends Content-Type: application/json", async () => {
      fetchMock.mockReturnValue(successResponse(projectFixture));
      await client.createProject({ name: "Test" });
      const lastCall = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = lastCall[1].headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("throws error when response.success is false", async () => {
      fetchMock.mockReturnValue(errorResponse("Project not found"));
      try {
        await client.getProject("missing-id");
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as Error).message).toBe("Project not found");
      }
    });

    it("throws generic error when success is false with no error message", async () => {
      fetchMock.mockReturnValue(
        new Response(JSON.stringify({ success: false }), { status: 500 }),
      );
      try {
        await client.getMe();
        throw new Error("should have thrown");
      } catch (error) {
        expect((error as Error).message).toBe("Unknown API error");
      }
    });

    it("returns response.data on success", async () => {
      fetchMock.mockReturnValue(successResponse(agentFixture));
      const result = await client.getMe();
      expect(result).toEqual(agentFixture);
    });
  });

  // -------------------------------------------------------------------------
  // createProject
  // -------------------------------------------------------------------------

  describe("createProject", () => {
    it("sends POST to /projects with correct body", async () => {
      fetchMock.mockReturnValue(successResponse(projectFixture));
      await client.createProject({ name: "My Project", description: "desc" });
      expect(lastUrl(fetchMock)).toBe(`${DEFAULT_BASE_URL}/projects`);
      const body = fetchMock.mock.calls[0] as [string, RequestInit];
      const init = body[1];
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        name: "My Project",
        description: "desc",
      });
    });

    it("returns Project object", async () => {
      fetchMock.mockReturnValue(successResponse(projectFixture));
      const result = await client.createProject({ name: "My Project" });
      expect(result).toEqual(projectFixture);
    });
  });

  // -------------------------------------------------------------------------
  // getFeed
  // -------------------------------------------------------------------------

  describe("getFeed", () => {
    it("sends GET to /feed", async () => {
      const paginated = paginatedOf<ActivityWithDetails>([]);
      fetchMock.mockReturnValue(successResponse(paginated));
      await client.getFeed();
      expect(lastUrl(fetchMock)).toBe(`${DEFAULT_BASE_URL}/feed`);
    });

    it("sends GET to /feed with query params", async () => {
      const paginated = paginatedOf<ActivityWithDetails>([]);
      fetchMock.mockReturnValue(successResponse(paginated));
      await client.getFeed({ pageSize: 10, type: "project_created" });
      const url = lastUrl(fetchMock);
      expect(url).toContain("pageSize=10");
      expect(url).toContain("type=project_created");
    });

    it("returns PaginatedResponse", async () => {
      const paginated = paginatedOf<ActivityWithDetails>([]);
      fetchMock.mockReturnValue(successResponse(paginated));
      const result = await client.getFeed({ pageSize: 20 });
      expect(result).toEqual(paginated);
    });
  });

  // -------------------------------------------------------------------------
  // submitContribution
  // -------------------------------------------------------------------------

  describe("submitContribution", () => {
    it("sends POST with files array", async () => {
      fetchMock.mockReturnValue(successResponse(contributionFixture));
      const input = {
        files: [{ path: "index.ts", content: "export {};", action: "create" as const }],
        message: "feat: add index",
      };
      await client.submitContribution("project-1", input);
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/projects/project-1/contributions`,
      );
      expect(lastBody(fetchMock)).toEqual(input);
    });

    it("returns Contribution object", async () => {
      fetchMock.mockReturnValue(successResponse(contributionFixture));
      const result = await client.submitContribution("project-1", {
        files: [],
      });
      expect(result).toEqual(contributionFixture);
    });
  });

  // -------------------------------------------------------------------------
  // joinProject
  // -------------------------------------------------------------------------

  describe("joinProject", () => {
    it("sends POST to /projects/:id/join", async () => {
      fetchMock.mockReturnValue(successResponse(null));
      await client.joinProject("project-1");
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/projects/project-1/join`,
      );
      const lastCall = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(lastCall[1].method).toBe("POST");
    });
  });

  // -------------------------------------------------------------------------
  // getFiles
  // -------------------------------------------------------------------------

  describe("getFiles", () => {
    it("sends GET to /projects/:id/files", async () => {
      fetchMock.mockReturnValue(successResponse(fileEntriesFixture));
      await client.getFiles("project-1");
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/projects/project-1/files`,
      );
    });

    it("appends path query param when provided", async () => {
      fetchMock.mockReturnValue(successResponse(fileEntriesFixture));
      await client.getFiles("project-1", "src/components");
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/projects/project-1/files?path=src%2Fcomponents`,
      );
    });

    it("returns GiteaFileEntry array", async () => {
      fetchMock.mockReturnValue(successResponse(fileEntriesFixture));
      const result = await client.getFiles("project-1");
      expect(result).toEqual(fileEntriesFixture);
    });
  });

  // -------------------------------------------------------------------------
  // listProjects
  // -------------------------------------------------------------------------

  describe("listProjects", () => {
    it("sends GET to /projects without params when called with no options", async () => {
      fetchMock.mockReturnValue(successResponse(paginatedOf([projectFixture])));
      await client.listProjects();
      expect(lastUrl(fetchMock)).toBe(`${DEFAULT_BASE_URL}/projects`);
    });

    it("includes status filter in query string", async () => {
      fetchMock.mockReturnValue(successResponse(paginatedOf([projectFixture])));
      await client.listProjects({ status: "open", page: 2 });
      const url = lastUrl(fetchMock);
      expect(url).toContain("status=open");
      expect(url).toContain("page=2");
    });
  });

  // -------------------------------------------------------------------------
  // getProject
  // -------------------------------------------------------------------------

  describe("getProject", () => {
    it("sends GET to /projects/:idOrSlug", async () => {
      const projectWithCollabs = {
        ...projectFixture,
        creator: agentFixture,
        collaborators: [] as AgentPublic[],
        buildCount: 0,
        latestBuild: null,
      } as unknown as ProjectWithCollaborators;
      fetchMock.mockReturnValue(successResponse(projectWithCollabs));
      const result = await client.getProject("test-project");
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/projects/test-project`,
      );
      expect(result).toEqual(projectWithCollabs);
    });
  });

  // -------------------------------------------------------------------------
  // leaveProject
  // -------------------------------------------------------------------------

  describe("leaveProject", () => {
    it("sends POST to /projects/:id/leave", async () => {
      fetchMock.mockReturnValue(successResponse(null));
      await client.leaveProject("project-1");
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/projects/project-1/leave`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // postMessage / listMessages
  // -------------------------------------------------------------------------

  describe("postMessage", () => {
    it("sends POST to /projects/:id/messages with content body", async () => {
      const messageFixture = {
        id: "msg-1",
        projectId: "project-1",
        agentId: "agent-1",
        content: "Hello world",
        createdAt: new Date("2026-01-01"),
      };
      fetchMock.mockReturnValue(successResponse(messageFixture));
      await client.postMessage("project-1", "Hello world");
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/projects/project-1/messages`,
      );
      expect(lastBody(fetchMock)).toEqual({ content: "Hello world" });
    });
  });

  // -------------------------------------------------------------------------
  // getContribution
  // -------------------------------------------------------------------------

  describe("getContribution", () => {
    it("sends GET to /contributions/:id", async () => {
      fetchMock.mockReturnValue(successResponse(contributionFixture));
      await client.getContribution("contribution-1");
      expect(lastUrl(fetchMock)).toBe(
        `${DEFAULT_BASE_URL}/contributions/contribution-1`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getPoolStatus
  // -------------------------------------------------------------------------

  describe("getPoolStatus", () => {
    it("sends GET to /pool/status", async () => {
      const poolStatus = {
        sandboxHoursUsedToday: 12,
        sandboxHoursLimitToday: 100,
        sandboxHoursRemaining: 88,
        activeSandboxes: 3,
        maxConcurrentSandboxes: 10,
        deployedApps: 2,
        maxDeployedApps: 5,
      };
      fetchMock.mockReturnValue(successResponse(poolStatus));
      const result = await client.getPoolStatus();
      expect(lastUrl(fetchMock)).toBe(`${DEFAULT_BASE_URL}/pool/status`);
      expect(result).toEqual(poolStatus);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("omits query string when all options are undefined", async () => {
      fetchMock.mockReturnValue(successResponse(paginatedOf([])));
      await client.listProjects({});
      expect(lastUrl(fetchMock)).toBe(`${DEFAULT_BASE_URL}/projects`);
    });

    it("does not send body on GET requests", async () => {
      fetchMock.mockReturnValue(successResponse(agentFixture));
      await client.getMe();
      const lastCall = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(lastCall[1].body).toBeUndefined();
    });
  });
});
