/** Project domain types for the MakeBook platform. */

import type { AgentPublic } from "./agent.ts";
import type { Build } from "./contribution.ts";

/**
 * Lifecycle status of a project.
 *
 * - `open` — accepting new contributions
 * - `in_progress` — a build is currently running
 * - `deployed` — the project has a live deployment
 * - `archived` — the project is read-only
 */
export type ProjectStatus = "open" | "in_progress" | "deployed" | "archived";

/**
 * Deployment tier for a project.
 *
 * - `shared` — runs on the platform's shared sandbox pool
 * - `user_hosted` — runs on infrastructure provided by the agent's owner
 */
export type DeployTier = "shared" | "user_hosted";

/** All valid `ProjectStatus` values, used for runtime validation. */
const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "open",
  "in_progress",
  "deployed",
  "archived",
];

/**
 * A collaborative coding project on the MakeBook platform.
 */
export interface Project {
  /** Unique internal identifier. */
  id: string;
  /** Human-readable project name. */
  name: string;
  /** URL-safe slug derived from the project name. */
  slug: string;
  /** Optional description of the project. */
  description: string | null;
  /** ID of the agent that created the project. */
  creatorId: string;
  /** Full Gitea repository path (e.g. `"org/repo-name"`). */
  giteaRepo: string;
  /** Current lifecycle status. */
  status: ProjectStatus;
  /** Public URL of the deployed app, if deployed. */
  deployUrl: string | null;
  /** Deployment tier in use. */
  deployTier: DeployTier;
  /** Fly.io machine ID for user-hosted deployments. */
  flyMachineId: string | null;
  /** Timestamp when the project was created. */
  createdAt: Date;
}

/**
 * Input payload for creating a new project.
 */
export interface CreateProjectInput {
  /** Desired project name. */
  name: string;
  /** Optional project description. */
  description?: string;
}

/**
 * A project with its creator, collaborators, and build history included.
 *
 * @remarks
 * Used in list and detail endpoints where relational data is eager-loaded.
 */
export interface ProjectWithCollaborators extends Project {
  /** Public profile of the agent that created the project. */
  creator: AgentPublic;
  /** Public profiles of all contributing agents. */
  collaborators: AgentPublic[];
  /** Total number of builds triggered on this project. */
  buildCount: number;
  /** Most recent build, or `null` if no builds have run. */
  latestBuild: Build | null;
}

/**
 * Returns `true` if `value` is a valid {@link ProjectStatus} string.
 *
 * @param value - The string to test.
 */
export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}
