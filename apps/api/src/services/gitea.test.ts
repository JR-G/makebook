import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GiteaService } from "./gitea.ts";

const BASE_URL = "http://gitea.test:3001";
const ADMIN_TOKEN = "test-admin-token";
const ORG = "makebook";

// --- Fetch mock infrastructure ---

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const capturedRequests: CapturedRequest[] = [];
const queuedResponses: Response[] = [];
const originalFetch = global.fetch;

function queueResponse(status: number, body: unknown): void {
  queuedResponses.push(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  capturedRequests.length = 0;
  queuedResponses.length = 0;
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as unknown;
      } catch {
        body = init.body;
      }
    }
    capturedRequests.push({ url, method, headers, body });
    const response = queuedResponses.shift();
    if (!response) throw new Error(`Unexpected fetch call to ${method} ${url}`);
    return response;
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function makeService(): GiteaService {
  return new GiteaService(BASE_URL, ADMIN_TOKEN);
}

// --- Tests ---

describe("GiteaService", () => {
  describe("createRepo", () => {
    test("sends correct POST to org repos endpoint with expected body", async () => {
      queueResponse(200, {});
      queueResponse(201, {
        clone_url: "http://gitea.test:3001/makebook/my-repo.git",
        html_url: "http://gitea.test:3001/makebook/my-repo",
      });

      await makeService().createRepo("my-repo", "A test repo");

      const orgCheck = capturedRequests[0]!;
      expect(orgCheck.url).toBe(`${BASE_URL}/api/v1/orgs/${ORG}`);
      expect(orgCheck.method).toBe("GET");
      expect(orgCheck.headers["Authorization"]).toBe(`token ${ADMIN_TOKEN}`);

      const repoCreate = capturedRequests[1]!;
      expect(repoCreate.url).toBe(`${BASE_URL}/api/v1/orgs/${ORG}/repos`);
      expect(repoCreate.method).toBe("POST");
      expect(repoCreate.headers["Authorization"]).toBe(`token ${ADMIN_TOKEN}`);
      expect(repoCreate.headers["Content-Type"]).toBe("application/json");
      expect(repoCreate.body).toMatchObject({
        name: "my-repo",
        description: "A test repo",
        auto_init: true,
        default_branch: "main",
        private: false,
      });
    });

    test("returns cloneUrl and htmlUrl from response", async () => {
      queueResponse(200, {});
      queueResponse(201, {
        clone_url: "http://gitea.test/makebook/test.git",
        html_url: "http://gitea.test/makebook/test",
      });

      const result = await makeService().createRepo("test");

      expect(result).toEqual({
        cloneUrl: "http://gitea.test/makebook/test.git",
        htmlUrl: "http://gitea.test/makebook/test",
      });
    });

    test("creates org first if org does not exist", async () => {
      queueResponse(404, {});
      queueResponse(201, {});
      queueResponse(201, {
        clone_url: "http://gitea.test/makebook/test.git",
        html_url: "http://gitea.test/makebook/test",
      });

      await makeService().createRepo("test");

      expect(capturedRequests).toHaveLength(3);
      expect(capturedRequests[0]!.method).toBe("GET");
      expect(capturedRequests[0]!.url).toContain(`/orgs/${ORG}`);
      expect(capturedRequests[1]!.method).toBe("POST");
      expect(capturedRequests[1]!.url).toBe(`${BASE_URL}/api/v1/orgs`);
      expect(capturedRequests[2]!.method).toBe("POST");
      expect(capturedRequests[2]!.url).toContain(`/orgs/${ORG}/repos`);
    });

    test("throws on non-2xx response for repo creation", async () => {
      queueResponse(200, {});
      queueResponse(422, { message: "repo already exists" });

      let thrownError: unknown;
      try {
        await makeService().createRepo("existing");
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toContain('Failed to create repository "existing"');
    });
  });

  describe("deleteRepo", () => {
    test("sends DELETE to correct URL", async () => {
      queueResponse(204, {});

      await makeService().deleteRepo("my-repo");

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0]!;
      expect(request.url).toBe(`${BASE_URL}/api/v1/repos/${ORG}/my-repo`);
      expect(request.method).toBe("DELETE");
      expect(request.headers["Authorization"]).toBe(`token ${ADMIN_TOKEN}`);
    });

    test("does not throw on 404 response", async () => {
      queueResponse(404, { message: "Not Found" });

      await makeService().deleteRepo("missing-repo");
    });

    test("throws on 500 response", async () => {
      queueResponse(500, { message: "Internal Server Error" });

      let thrownError: unknown;
      try {
        await makeService().deleteRepo("my-repo");
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toContain('Failed to delete repository "my-repo"');
    });
  });

  describe("commitFiles", () => {
    test("GETs existing file SHA before update", async () => {
      queueResponse(200, {
        content: Buffer.from("old content").toString("base64"),
        sha: "abc123",
      });
      queueResponse(200, { commit: { sha: "commit-sha-1" } });

      await makeService().commitFiles(
        "my-repo",
        [{ path: "README.md", content: "new content", action: "update" }],
        "Update README",
        "testbot",
      );

      expect(capturedRequests[0]!.method).toBe("GET");
      expect(capturedRequests[0]!.url).toContain("README.md");
      expect(capturedRequests[1]!.method).toBe("PUT");
      expect((capturedRequests[1]!.body as Record<string, unknown>)["sha"]).toBe("abc123");
    });

    test("PUTs file with base64-encoded content", async () => {
      queueResponse(201, { commit: { sha: "new-commit-sha" } });

      await makeService().commitFiles(
        "my-repo",
        [{ path: "src/main.ts", content: "const x = 1;", action: "create" }],
        "Add main.ts",
        "testbot",
      );

      const putRequest = capturedRequests[0]!;
      expect(putRequest.method).toBe("PUT");
      const body = putRequest.body as Record<string, unknown>;
      expect(body["content"]).toBe(Buffer.from("const x = 1;").toString("base64"));
    });

    test("returns commit SHA from response", async () => {
      queueResponse(201, { commit: { sha: "final-sha-abc" } });

      const sha = await makeService().commitFiles(
        "my-repo",
        [{ path: "file.ts", content: "export {};", action: "create" }],
        "Add file",
        "testbot",
      );

      expect(sha).toBe("final-sha-abc");
    });

    test("handles create action without fetching existing SHA", async () => {
      queueResponse(201, { commit: { sha: "create-sha" } });

      await makeService().commitFiles(
        "my-repo",
        [{ path: "new-file.ts", content: "// new", action: "create" }],
        "Create file",
        "author",
      );

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]!.method).toBe("PUT");
      const body = capturedRequests[0]!.body as Record<string, unknown>;
      expect(body["sha"]).toBeUndefined();
    });

    test("handles delete action by fetching SHA then sending DELETE", async () => {
      queueResponse(200, {
        content: Buffer.from("content").toString("base64"),
        sha: "del-sha-xyz",
      });
      queueResponse(200, { commit: { sha: "del-commit-sha" } });

      const sha = await makeService().commitFiles(
        "my-repo",
        [{ path: "old-file.ts", content: "", action: "delete" }],
        "Remove file",
        "author",
      );

      expect(capturedRequests[0]!.method).toBe("GET");
      expect(capturedRequests[1]!.method).toBe("DELETE");
      const deleteBody = capturedRequests[1]!.body as Record<string, unknown>;
      expect(deleteBody["sha"]).toBe("del-sha-xyz");
      expect(sha).toBe("del-commit-sha");
    });

    test("throws if update target file does not exist", async () => {
      queueResponse(404, {});

      let thrownError: unknown;
      try {
        await makeService().commitFiles(
          "my-repo",
          [{ path: "missing.ts", content: "x", action: "update" }],
          "Update missing",
          "author",
        );
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toContain('Cannot update file "missing.ts"');
    });
  });

  describe("getFile", () => {
    test("returns decoded content and SHA for existing file", async () => {
      const originalContent = "export const hello = 'world';";
      queueResponse(200, {
        content: Buffer.from(originalContent).toString("base64"),
        sha: "file-sha-123",
      });

      const result = await makeService().getFile("my-repo", "src/index.ts");

      expect(result).toEqual({
        content: originalContent,
        sha: "file-sha-123",
      });
      expect(capturedRequests[0]!.url).toContain("src/index.ts?ref=main");
    });

    test("returns null for 404", async () => {
      queueResponse(404, { message: "Not Found" });

      const result = await makeService().getFile("my-repo", "nonexistent.ts");

      expect(result).toBeNull();
    });

    test("uses provided ref in request URL", async () => {
      queueResponse(200, {
        content: Buffer.from("x").toString("base64"),
        sha: "sha",
      });

      await makeService().getFile("my-repo", "file.ts", "feat/my-branch");

      expect(capturedRequests[0]!.url).toContain("?ref=feat/my-branch");
    });
  });

  describe("listFiles", () => {
    test("returns mapped GiteaFileEntry array", async () => {
      queueResponse(200, [
        { name: "src", path: "src", type: "dir", size: 0 },
        { name: "README.md", path: "README.md", type: "file", size: 128 },
      ]);

      const result = await makeService().listFiles("my-repo");

      expect(result).toEqual([
        { name: "src", path: "src", type: "dir", size: 0 },
        { name: "README.md", path: "README.md", type: "file", size: 128 },
      ]);
    });

    test("returns empty array for 404", async () => {
      queueResponse(404, {});

      const result = await makeService().listFiles("my-repo", "missing/");

      expect(result).toEqual([]);
    });

    test("includes path and ref in request URL", async () => {
      queueResponse(200, []);

      await makeService().listFiles("my-repo", "src/", "develop");

      expect(capturedRequests[0]!.url).toContain("src/?ref=develop");
    });
  });

  describe("getCommitLog", () => {
    test("returns simplified commit objects", async () => {
      queueResponse(200, [
        {
          sha: "commit-abc",
          commit: {
            message: "feat: add feature",
            author: { name: "Dev Bot", date: "2026-03-01T12:00:00Z" },
          },
        },
      ]);

      const result = await makeService().getCommitLog("my-repo");

      expect(result).toEqual([
        {
          sha: "commit-abc",
          message: "feat: add feature",
          author: "Dev Bot",
          date: "2026-03-01T12:00:00Z",
        },
      ]);
    });

    test("uses default limit of 20 when none provided", async () => {
      queueResponse(200, []);

      await makeService().getCommitLog("my-repo");

      expect(capturedRequests[0]!.url).toContain("?limit=20");
    });

    test("uses provided limit in request URL", async () => {
      queueResponse(200, []);

      await makeService().getCommitLog("my-repo", 5);

      expect(capturedRequests[0]!.url).toContain("?limit=5");
    });
  });

  describe("ensureOrg", () => {
    test("does not create org if it already exists", async () => {
      queueResponse(200, { username: ORG });

      await makeService().ensureOrg();

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]!.method).toBe("GET");
      expect(capturedRequests[0]!.url).toBe(`${BASE_URL}/api/v1/orgs/${ORG}`);
    });

    test("creates org if it does not exist", async () => {
      queueResponse(404, {});
      queueResponse(201, {});

      await makeService().ensureOrg();

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[0]!.method).toBe("GET");
      expect(capturedRequests[1]!.method).toBe("POST");
      expect(capturedRequests[1]!.url).toBe(`${BASE_URL}/api/v1/orgs`);
      expect(capturedRequests[1]!.body).toEqual({
        username: ORG,
        visibility: "public",
      });
    });
  });
});
