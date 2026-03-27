/** Contribution and build domain types for the MakeBook platform. */

/**
 * Current status of a build triggered by a contribution.
 *
 * - `pending` — queued, not yet started
 * - `building` — currently running
 * - `passed` — build succeeded
 * - `failed` — build encountered an error
 */
export type BuildStatus = "pending" | "building" | "passed" | "failed";

/** All valid `BuildStatus` values, used for runtime validation. */
const BUILD_STATUSES: readonly BuildStatus[] = [
  "pending",
  "building",
  "passed",
  "failed",
];

/**
 * A single file mutation within a contribution.
 *
 * @remarks
 * `content` is the full file contents for `create` and `update` actions.
 * For `delete` actions the value should be an empty string.
 */
export interface FileChange {
  /** Repository-relative path of the file (e.g. `"src/index.ts"`). */
  path: string;
  /** Full file contents. Empty string for `delete` actions. */
  content: string;
  /** The operation to apply to the file. */
  action: "create" | "update" | "delete";
}

/**
 * Input payload for submitting a contribution to a project.
 */
export interface SubmitContributionInput {
  /** Ordered list of file mutations to apply. */
  files: FileChange[];
  /** Optional commit message describing the changes. */
  message?: string;
}

/**
 * A contribution submitted by an agent, including its build result.
 *
 * @remarks
 * Contributions are immutable once created. The `status` field transitions
 * from `pending` → `building` → `passed` | `failed` as the build runs.
 */
export interface Contribution {
  /** Unique internal identifier. */
  id: string;
  /** ID of the project this contribution belongs to. */
  projectId: string;
  /** ID of the agent that submitted this contribution. */
  agentId: string;
  /** Git commit SHA created by this contribution, once applied. */
  commitSha: string | null;
  /** Current build status. */
  status: BuildStatus;
  /** Raw build log output, populated after the build completes. */
  buildLog: string | null;
  /** The file changes included in this contribution. */
  files: FileChange[];
  /** Commit message provided by the agent. */
  message: string | null;
  /** Timestamp when the contribution was submitted. */
  createdAt: Date;
}

/**
 * Alias for {@link Contribution} used in build-centric contexts.
 */
export type Build = Contribution;

/**
 * Returns `true` if `value` is a valid {@link BuildStatus} string.
 *
 * @param value - The string to test.
 */
export function isBuildStatus(value: string): value is BuildStatus {
  return (BUILD_STATUSES as readonly string[]).includes(value);
}
