import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import type { Pool } from "pg";
import type { Project } from "@makebook/types";
import { DeployService } from "./deploy.ts";

const PLATFORM_TOKEN = "platform-fly-token";
const ORG_SLUG = "makebook-org";
const EXPIRY_HOURS = 48;

const TEST_CONFIG = {
  flyApiToken: PLATFORM_TOKEN,
  flyOrgSlug: ORG_SLUG,
  deployExpiryHours: EXPIRY_HOURS,
};

const TEST_PROJECT: Project = {
  id: "proj-123",
  slug: "my-project",
  name: "My Project",
  description: null,
  creatorId: "agent-1",
  giteaRepo: "org/my-project",
  status: "in_progress",
  deployUrl: null,
  deployTier: "shared",
  flyMachineId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function makePool(queryResult: { rows: unknown[]; rowCount: number } = { rows: [], rowCount: 0 }): Pool {
  return {
    query: mock(() => Promise.resolve(queryResult)),
  } as unknown as Pool;
}

function makeFetchResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status },
  );
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("DeployService.deploy", () => {
  test("creates app and machine, updates database, returns deployUrl and machineId", async () => {
    const machineId = "machine-abc";
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);

    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) return makeFetchResponse({}, 201);
      return makeFetchResponse({ id: machineId, state: "started" }, 200);
    }) as unknown as typeof fetch;

    const result = await service.deploy(TEST_PROJECT, {});

    expect(result.deployUrl).toBe("https://makebook-my-project.fly.dev");
    expect(result.machineId).toBe(machineId);
    expect((pool.query as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test("uses provided flyToken over platform token", async () => {
    const userToken = "user-fly-token";
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    const capturedHeaders: string[] = [];

    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      capturedHeaders.push((init?.headers as Record<string, string>)["Authorization"] ?? "");
      if (capturedHeaders.length === 1) return makeFetchResponse({}, 201);
      return makeFetchResponse({ id: "machine-1", state: "started" }, 200);
    }) as unknown as typeof fetch;

    await service.deploy(TEST_PROJECT, { flyToken: userToken });

    expect(capturedHeaders[0]).toBe(`Bearer ${userToken}`);
    expect(capturedHeaders[1]).toBe(`Bearer ${userToken}`);
  });

  test("falls back to platform flyApiToken when no flyToken provided", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    const capturedHeaders: string[] = [];

    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      capturedHeaders.push((init?.headers as Record<string, string>)["Authorization"] ?? "");
      if (capturedHeaders.length === 1) return makeFetchResponse({}, 201);
      return makeFetchResponse({ id: "machine-1", state: "started" }, 200);
    }) as unknown as typeof fetch;

    await service.deploy(TEST_PROJECT, {});

    expect(capturedHeaders[0]).toBe(`Bearer ${PLATFORM_TOKEN}`);
  });

  test("proceeds when app creation returns 409 (app already exists)", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    let callCount = 0;

    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) return makeFetchResponse("conflict", 409);
      return makeFetchResponse({ id: "machine-1", state: "started" }, 200);
    }) as unknown as typeof fetch;

    const result = await service.deploy(TEST_PROJECT, {});
    expect(result.machineId).toBe("machine-1");
  });

  test("throws when app creation fails with non-409 status", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async () =>
      makeFetchResponse("internal server error", 500),
    ) as unknown as typeof fetch;

    let caughtError: Error | undefined;
    try {
      await service.deploy(TEST_PROJECT, {});
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError?.message).toContain("Failed to create Fly app: 500");
  });

  test("throws when machine creation fails", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    let callCount = 0;

    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) return makeFetchResponse({}, 201);
      return makeFetchResponse("machine quota exceeded", 422);
    }) as unknown as typeof fetch;

    let caughtError: Error | undefined;
    try {
      await service.deploy(TEST_PROJECT, {});
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError?.message).toContain("Failed to create Fly machine: 422");
  });

  test("constructs app name as makebook-{slug}", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    const capturedUrls: string[] = [];

    globalThis.fetch = mock(async (url: string | URL) => {
      capturedUrls.push(url.toString());
      if (capturedUrls.length === 1) return makeFetchResponse({}, 201);
      return makeFetchResponse({ id: "m1", state: "started" }, 200);
    }) as unknown as typeof fetch;

    await service.deploy(TEST_PROJECT, {});

    expect(capturedUrls[1]).toContain("makebook-my-project/machines");
  });

  test("enables auto-start and auto-stop on machine services", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    let capturedServiceConfig: Record<string, unknown> | undefined;

    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      const targetUrl = url.toString();
      if (targetUrl.endsWith("/apps")) {
        return makeFetchResponse({}, 201);
      }

      capturedServiceConfig = JSON.parse(String(init?.body)).config.services[0];
      return makeFetchResponse({ id: "machine-1", state: "started" }, 200);
    }) as unknown as typeof fetch;

    await service.deploy(TEST_PROJECT, {});

    expect(capturedServiceConfig?.autostart).toBe(true);
    expect(capturedServiceConfig?.autostop).toBe("stop");
    expect(capturedServiceConfig?.min_machines_running).toBe(0);
  });

  test("selects guest config based on deploy tier", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    const capturedGuests: Record<string, unknown>[] = [];

    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      const targetUrl = url.toString();
      if (targetUrl.endsWith("/apps")) {
        return makeFetchResponse({}, 201);
      }

      capturedGuests.push(JSON.parse(String(init?.body)).config.guest);
      return makeFetchResponse(
        { id: `machine-${capturedGuests.length}`, state: "started" },
        200,
      );
    }) as unknown as typeof fetch;

    await service.deploy(TEST_PROJECT, {});
    await service.deploy(
      {
        ...TEST_PROJECT,
        id: "proj-user-tier",
        slug: "user-tier",
        deployTier: "user_hosted",
      },
      {},
    );

    expect(capturedGuests[0]).toEqual({
      cpu_kind: "shared",
      cpus: 1,
      memory_mb: 256,
    });
    expect(capturedGuests[1]).toEqual({
      cpu_kind: "performance",
      cpus: 1,
      memory_mb: 512,
    });
  });
});

describe("DeployService.destroy", () => {
  test("appends ?force=true to the DELETE URL", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    let capturedUrl: string | undefined;
    globalThis.fetch = mock(async (url: string | URL) => {
      capturedUrl = url.toString();
      return makeFetchResponse({}, 200);
    }) as unknown as typeof fetch;

    await service.destroy("machine-abc", "makebook-my-project");

    expect(capturedUrl).toContain("?force=true");
  });

  test("respects optional flyToken with fallback to platform token", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    const auths: string[] = [];
    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      auths.push((init?.headers as Record<string, string>)["Authorization"] ?? "");
      return makeFetchResponse({}, 200);
    }) as unknown as typeof fetch;

    await service.destroy("machine-abc", "makebook-my-project", "user-token");
    await service.destroy("machine-abc", "makebook-my-project");

    expect(auths[0]).toBe("Bearer user-token");
    expect(auths[1]).toBe(`Bearer ${PLATFORM_TOKEN}`);
  });

  test("calls DELETE on the machine endpoint", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    let capturedMethod: string | undefined;

    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      capturedMethod = init?.method;
      return makeFetchResponse({}, 200);
    }) as unknown as typeof fetch;

    await service.destroy("machine-abc", "makebook-my-project");

    expect(capturedMethod).toBe("DELETE");
  });

  test("swallows 404 — machine already gone", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async () =>
      makeFetchResponse("not found", 404),
    ) as unknown as typeof fetch;

    const result = await service.destroy("machine-abc", "makebook-my-project");
    expect(result).toBeUndefined();
  });

  test("throws on non-404 failure", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async () =>
      makeFetchResponse("forbidden", 403),
    ) as unknown as typeof fetch;

    let caughtError: Error | undefined;
    try {
      await service.destroy("machine-abc", "makebook-my-project");
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError?.message).toContain("Failed to destroy Fly machine machine-abc: 403");
  });
});

describe("DeployService.stop", () => {
  test("respects optional flyToken with fallback to platform token", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    const auths: string[] = [];

    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      auths.push((init?.headers as Record<string, string>)["Authorization"] ?? "");
      return makeFetchResponse({}, 200);
    }) as unknown as typeof fetch;

    await service.stop("machine-abc", "makebook-my-project", "user-token");
    await service.stop("machine-abc", "makebook-my-project");

    expect(auths[0]).toBe("Bearer user-token");
    expect(auths[1]).toBe(`Bearer ${PLATFORM_TOKEN}`);
  });

  test("calls POST to the stop endpoint", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;

    globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedMethod = init?.method;
      return makeFetchResponse({}, 200);
    }) as unknown as typeof fetch;

    await service.stop("machine-abc", "makebook-my-project");

    expect(capturedMethod).toBe("POST");
    expect(capturedUrl).toContain("/stop");
  });

  test("throws on stop failure", async () => {
    const pool = makePool();
    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async () =>
      makeFetchResponse("unavailable", 503),
    ) as unknown as typeof fetch;

    let caughtError: Error | undefined;
    try {
      await service.stop("machine-abc", "makebook-my-project");
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError?.message).toContain("Failed to stop Fly machine machine-abc: 503");
  });
});

describe("DeployService.getStatus", () => {
  test("maps 'started' state to 'running'", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    globalThis.fetch = mock(async () =>
      makeFetchResponse({ id: "m1", state: "started" }),
    ) as unknown as typeof fetch;

    expect(await service.getStatus("m1", "app")).toBe("running");
  });

  test("maps 'stopped' state to 'stopped'", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    globalThis.fetch = mock(async () =>
      makeFetchResponse({ id: "m1", state: "stopped" }),
    ) as unknown as typeof fetch;

    expect(await service.getStatus("m1", "app")).toBe("stopped");
  });

  test("maps 'suspended' state to 'stopped'", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    globalThis.fetch = mock(async () =>
      makeFetchResponse({ id: "m1", state: "suspended" }),
    ) as unknown as typeof fetch;

    expect(await service.getStatus("m1", "app")).toBe("stopped");
  });

  test("maps 'destroyed' state to 'destroyed'", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    globalThis.fetch = mock(async () =>
      makeFetchResponse({ id: "m1", state: "destroyed" }),
    ) as unknown as typeof fetch;

    expect(await service.getStatus("m1", "app")).toBe("destroyed");
  });

  test("maps 404 response to 'destroyed'", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    globalThis.fetch = mock(async () =>
      makeFetchResponse("not found", 404),
    ) as unknown as typeof fetch;

    expect(await service.getStatus("m1", "app")).toBe("destroyed");
  });

  test("maps non-ok response to 'unknown'", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    globalThis.fetch = mock(async () =>
      makeFetchResponse("error", 500),
    ) as unknown as typeof fetch;

    expect(await service.getStatus("m1", "app")).toBe("unknown");
  });

  test("maps unrecognised state string to 'unknown'", async () => {
    const service = new DeployService(makePool(), TEST_CONFIG);
    globalThis.fetch = mock(async () =>
      makeFetchResponse({ id: "m1", state: "launching" }),
    ) as unknown as typeof fetch;

    expect(await service.getStatus("m1", "app")).toBe("unknown");
  });
});

describe("DeployService.checkExpired", () => {
  test("returns deployed projects older than the expiry window", async () => {
    const rows = [
      { id: "proj-1", fly_machine_id: "machine-1", slug: "project-one" },
      { id: "proj-2", fly_machine_id: "machine-2", slug: "project-two" },
    ];
    const pool = makePool({ rows, rowCount: rows.length });
    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async () => makeFetchResponse({})) as unknown as typeof fetch;

    const expired = await service.checkExpired();

    expect(expired).toHaveLength(2);
    expect(expired[0]).toEqual({
      id: "proj-1",
      flyMachineId: "machine-1",
      slug: "project-one",
    });
    expect(expired[1]).toEqual({
      id: "proj-2",
      flyMachineId: "machine-2",
      slug: "project-two",
    });
  });

  test("returns empty array when no projects are expired", async () => {
    const pool = makePool({ rows: [], rowCount: 0 });
    const service = new DeployService(pool, TEST_CONFIG);

    const expired = await service.checkExpired();
    expect(expired).toHaveLength(0);
  });

  test("passes deployExpiryHours as query parameter", async () => {
    const pool = makePool();
    const service = new DeployService(pool, { ...TEST_CONFIG, deployExpiryHours: 72 });

    await service.checkExpired();

    const queryCall = (pool.query as ReturnType<typeof mock>).mock.calls[0] as [string, unknown[]];
    expect(queryCall[1]).toEqual([72]);
  });
});

describe("DeployService.expireAll", () => {
  test("destroys expired machines and archives them in the database", async () => {
    const expiredRows = [
      { id: "proj-1", fly_machine_id: "machine-1", slug: "project-one" },
    ];
    const queryCalls: unknown[][] = [];
    const pool = {
      query: mock(async (...args: unknown[]) => {
        queryCalls.push(args);
        if (queryCalls.length === 1) return { rows: expiredRows, rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;

    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async () =>
      makeFetchResponse({}, 200),
    ) as unknown as typeof fetch;

    const count = await service.expireAll();

    expect(count).toBe(1);
    const archiveCall = queryCalls[1] as [string, string[]];
    expect(archiveCall[1]).toContain("proj-1");
    expect(archiveCall[0] as string).toContain("deploy_url = NULL");
    expect(archiveCall[0] as string).toContain("fly_machine_id = NULL");
  });

  test("returns zero when no projects are expired", async () => {
    const pool = makePool({ rows: [], rowCount: 0 });
    const service = new DeployService(pool, TEST_CONFIG);

    const count = await service.expireAll();
    expect(count).toBe(0);
  });

  test("continues processing remaining projects when one destroy fails", async () => {
    const expiredRows = [
      { id: "proj-fail", fly_machine_id: "machine-bad", slug: "fail-project" },
      { id: "proj-ok", fly_machine_id: "machine-good", slug: "ok-project" },
    ];
    const queryCalls: unknown[][] = [];
    const pool = {
      query: mock(async (...args: unknown[]) => {
        queryCalls.push(args);
        if (queryCalls.length === 1) return { rows: expiredRows, rowCount: 2 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;

    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async (url: string | URL) => {
      if (url.toString().includes("machine-bad")) return makeFetchResponse("error", 500);
      return makeFetchResponse({}, 200);
    }) as unknown as typeof fetch;

    const count = await service.expireAll();

    expect(count).toBe(1);
  });

  test("swallows 404 from destroy during expiry run", async () => {
    const expiredRows = [
      { id: "proj-1", fly_machine_id: "machine-gone", slug: "gone-project" },
    ];
    const queryCalls: unknown[][] = [];
    const pool = {
      query: mock(async (...args: unknown[]) => {
        queryCalls.push(args);
        if (queryCalls.length === 1) return { rows: expiredRows, rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as Pool;

    const service = new DeployService(pool, TEST_CONFIG);

    globalThis.fetch = mock(async () =>
      makeFetchResponse("not found", 404),
    ) as unknown as typeof fetch;

    const count = await service.expireAll();
    expect(count).toBe(1);
  });
});
