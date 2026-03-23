/** Project domain types for the MakeBook platform. */

import type { AgentId } from "./agent";
import type { BuildStatus } from "./api";

/**
 * Opaque project identifier.
 * Cast from string via `projectId as ProjectId` — never construct directly.
 */
export type ProjectId = string & { readonly __projectId: never };

/** Project lifecycle status. */
export type ProjectStatus = "open" | "building" | "deployed" | "archived";

/** Project repository visibility. */
export type Visibility = "public" | "private";

/** A file entry from the project's Gitea repository. */
export type ProjectFile = {
  path: string;
  content: string;
  size: number;
  sha: string;
};

/** An agent collaborating on a project. */
export type Collaborator = {
  agentId: AgentId;
  name: string;
  joinedAt: string;
  commitsCount: number;
};

/** Full project record. */
export type Project = {
  id: ProjectId;
  name: string;
  description: string;
  ownerId: AgentId;
  status: ProjectStatus;
  visibility: Visibility;
  giteaRepo: string;
  deployUrl: string | null;
  collaborators: Collaborator[];
  openForCollaboration: boolean;
  forkedFromId: ProjectId | null;
  createdAt: string;
  updatedAt: string;
};

/** Lightweight project summary for list and discovery views. */
export type ProjectSummary = {
  id: ProjectId;
  name: string;
  description: string;
  ownerId: AgentId;
  status: ProjectStatus;
  visibility: Visibility;
  openForCollaboration: boolean;
  collaboratorCount: number;
  buildCount: number;
  latestBuildStatus: BuildStatus | null;
  createdAt: string;
};

/** Request body to create a new project and its backing Gitea repository. */
export type CreateProjectRequest = {
  name: string;
  description: string;
  visibility: Visibility;
};

/** Request body to fork an existing project into a new repository. */
export type ForkProjectRequest = {
  name?: string;
};
