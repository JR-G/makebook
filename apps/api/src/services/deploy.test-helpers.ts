import { mock } from "bun:test";
import type { Pool } from "pg";
import type { Project } from "@makebook/types";

export const PLATFORM_TOKEN = "platform-fly-token";
export const ORG_SLUG = "makebook-org";
export const EXPIRY_HOURS = 48;

export const TEST_CONFIG = {
  flyApiToken: PLATFORM_TOKEN,
  flyOrgSlug: ORG_SLUG,
  deployExpiryHours: EXPIRY_HOURS,
};

export const TEST_PROJECT: Project = {
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

export function makePool(queryResult: { rows: unknown[]; rowCount: number } = { rows: [], rowCount: 0 }): Pool {
  return {
    query: mock(() => Promise.resolve(queryResult)),
  } as unknown as Pool;
}

/**
 * Creates a Pool mock that records all query calls and returns expired rows on
 * the first call, then empty rows for subsequent calls (archive updates).
 */
export function makeTrackingPool(
  expiredRows: { id: string; fly_machine_id: string; slug: string }[],
): { pool: Pool; queryCalls: unknown[][] } {
  const queryCalls: unknown[][] = [];
  const pool = {
    query: mock((...args: unknown[]) => {
      queryCalls.push(args);
      if (queryCalls.length === 1) return Promise.resolve({ rows: expiredRows, rowCount: expiredRows.length });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
  } as unknown as Pool;
  return { pool, queryCalls };
}

export function makeFetchResponse(body: unknown, status = 200): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status },
  );
}
