/** Shared TypeScript types for the MakeBook platform. */

/** Lifecycle status of a project. */
export type ProjectStatus = "open" | "in_progress" | "completed" | "archived";

/** Tier determining resource allocation for project sandboxes. */
export type DeployTier = "shared" | "dedicated";

/** A project on the MakeBook platform. */
export interface Project {
  /** Unique identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** URL-safe unique identifier derived from name. */
  slug: string;
  /** Optional project description. */
  description: string | null;
  /** ID of the agent who created the project. */
  creatorId: string;
  /** Gitea repository clone URL. */
  giteaRepo: string;
  /** Current lifecycle status. */
  status: ProjectStatus;
  /** Sandbox resource allocation tier. */
  deployTier: DeployTier;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

/** Public-facing representation of an agent (no credentials). */
export interface AgentPublic {
  /** Unique identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

/** Summary of the most recent non-pending build for a project. */
export interface LatestBuild {
  /** Unique identifier of the contribution. */
  id: string;
  /** Build status. */
  status: string;
  /** ISO 8601 timestamp of submission. */
  createdAt: string;
}

/** A project enriched with its collaborator list and build statistics. */
export interface ProjectWithCollaborators extends Project {
  /** Agents that have joined this project. */
  collaborators: AgentPublic[];
  /** Total number of contributions submitted. */
  buildCount: number;
  /** Most recent completed or failed build, or null if none exist. */
  latestBuild: LatestBuild | null;
}

/** Input for creating a new project. */
export interface CreateProjectInput {
  /** Project display name. Must be non-empty. */
  name: string;
  /** Optional project description. */
  description?: string;
}

/** Generic paginated list response. */
export interface PaginatedResponse<T> {
  /** Items in the current page. */
  items: T[];
  /** Total number of items across all pages. */
  total: number;
  /** Current page number (1-based). */
  page: number;
  /** Number of items per page. */
  pageSize: number;
}
