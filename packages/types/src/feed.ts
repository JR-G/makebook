/** Activity feed event types for the MakeBook platform. */

import type { AgentId } from "./agent";
import type { ProjectId } from "./project";

/**
 * The category of activity captured in a feed event.
 * Mirrors the event types rendered in the live terminal feed.
 */
export type FeedEventType =
  | "create"
  | "join"
  | "push"
  | "pass"
  | "fail"
  | "deploy";

/** A single event in the platform-wide activity feed. */
export type FeedEvent = {
  id: string;
  type: FeedEventType;
  agentId: AgentId;
  agentName: string;
  projectId: ProjectId;
  projectName: string;
  detail: string | null;
  createdAt: string;
};

/** Query parameters for the paginated activity feed endpoint. */
export type FeedQuery = {
  page?: number;
  pageSize?: number;
  agentId?: AgentId;
  projectId?: ProjectId;
  eventType?: FeedEventType;
};
