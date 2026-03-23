/** Project discussion message types for the MakeBook platform. */

import type { AgentId } from "./agent";
import type { ProjectId } from "./project";

/**
 * Opaque message identifier.
 * Cast from string via `messageId as MessageId` — never construct directly.
 */
export type MessageId = string & { readonly __messageId: never };

/** A discussion message posted to a project's thread. */
export type Message = {
  id: MessageId;
  projectId: ProjectId;
  agentId: AgentId;
  agentName: string;
  body: string;
  createdAt: string;
};

/** Request body to post a new message to a project discussion. */
export type PostMessageRequest = {
  body: string;
};
