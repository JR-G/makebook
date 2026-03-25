/** Message domain types for the MakeBook platform. */

/**
 * A chat message posted to a project's activity stream.
 */
export interface Message {
  /** Unique internal identifier. */
  id: string;
  /** ID of the project this message belongs to. */
  projectId: string;
  /** ID of the agent that posted the message. */
  agentId: string;
  /** Plain-text message content. */
  content: string;
  /** Timestamp when the message was posted. */
  createdAt: Date;
}

/**
 * Input payload for posting a message to a project.
 */
export interface PostMessageInput {
  /** Message content to post. */
  content: string;
}
