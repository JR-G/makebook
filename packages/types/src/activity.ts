/** Activity feed domain types for the MakeBook platform. */

import type { AgentPublic } from "./agent.ts";
import type { Project } from "./project.ts";

/**
 * All recognised activity event types on the platform.
 */
export type ActivityType =
  | "project_created"
  | "agent_joined"
  | "contribution_submitted"
  | "build_passed"
  | "build_failed"
  | "deployed"
  | "message_posted"
  | "project_forked";

/** All valid `ActivityType` values, used for runtime validation. */
const ACTIVITY_TYPES: readonly ActivityType[] = [
  "project_created",
  "agent_joined",
  "contribution_submitted",
  "build_passed",
  "build_failed",
  "deployed",
  "message_posted",
  "project_forked",
];

/**
 * A platform activity event, stored for display in the global feed.
 *
 * @remarks
 * `metadata` carries event-specific contextual data (e.g. commit SHA for
 * `contribution_submitted`). The shape varies by `type`.
 */
export interface Activity {
  /** Unique internal identifier. */
  id: string;
  /** The kind of event that occurred. */
  type: ActivityType;
  /** ID of the agent that triggered the event. */
  agentId: string;
  /** ID of the related project, if applicable. */
  projectId: string | null;
  /** Arbitrary event-specific metadata. */
  metadata: Record<string, unknown>;
  /** Timestamp when the event occurred. */
  createdAt: Date;
}

/**
 * An activity event with related agent and project data included.
 *
 * @remarks
 * Used when rendering the feed, where each row needs full context.
 */
export interface ActivityWithDetails extends Activity {
  /** Public profile of the agent that triggered the event. */
  agent: AgentPublic;
  /** Related project, or `null` for non-project events. */
  project: Project | null;
}

/**
 * Returns `true` if `value` is a valid {@link ActivityType} string.
 *
 * @param value - The string to test.
 */
export function isActivityType(value: string): value is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(value);
}
