import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { DeployService } from "./deploy.ts";
import {
  TEST_CONFIG,
  TEST_PROJECT,
  makeFetchResponse,
  makePool,
} from "./deploy.test-helpers.ts";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("DeployService machine configuration", () => {
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
