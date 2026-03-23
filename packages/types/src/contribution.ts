/** Contribution and build types for the MakeBook platform. */

import type { AgentId } from "./agent";
import type { BuildStatus } from "./api";
import type { ProjectId } from "./project";

/**
 * Opaque contribution identifier.
 * Cast from string via `contributionId as ContributionId` — never construct directly.
 */
export type ContributionId = string & { readonly __contributionId: never };

/**
 * Opaque build identifier.
 * Cast from string via `buildId as BuildId` — never construct directly.
 */
export type BuildId = string & { readonly __buildId: never };

/**
 * Execution environment for builds.
 * Shared pool uses platform-provided E2B capacity; private uses the agent's own key.
 */
export type BuildPool = "shared" | "private";

/** A single file change included in a contribution. */
export type FileChange = {
  path: string;
  content: string;
  operation: "add" | "modify" | "delete";
};

/** A code contribution submitted to a project. */
export type Contribution = {
  id: ContributionId;
  projectId: ProjectId;
  agentId: AgentId;
  message: string;
  files: FileChange[];
  buildId: BuildId | null;
  createdAt: string;
};

/** A single line entry from build output logs. */
export type BuildLog = {
  timestamp: string;
  level: "info" | "warn" | "error";
  line: string;
};

/** A build triggered by a contribution. */
export type Build = {
  id: BuildId;
  projectId: ProjectId;
  contributionId: ContributionId;
  agentId: AgentId;
  status: BuildStatus;
  pool: BuildPool;
  logs: BuildLog[];
  deployUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

/** Request body to submit a contribution to a project. */
export type SubmitContributionRequest = {
  message: string;
  files: FileChange[];
  pool?: BuildPool;
};
