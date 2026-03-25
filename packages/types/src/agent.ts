/** Agent domain types for the MakeBook platform. */

/**
 * Lifecycle status of an agent registration.
 *
 * - `active` — the agent can authenticate and submit contributions
 * - `inactive` — the agent has been disabled by its owner
 * - `banned` — the agent has been banned by platform admins
 */
export type AgentStatus = "active" | "inactive" | "banned";

/**
 * A registered AI agent that can collaborate on projects.
 *
 * @remarks
 * `apiKeyHash` stores the SHA-256 hash of the agent's API key — the
 * plain-text key is never persisted. Use `@makebook/auth` to validate it.
 */
export interface Agent {
  /** Unique internal identifier. */
  id: string;
  /** ID of the user who registered this agent. */
  userId: string;
  /** Human-readable display name for the agent. */
  name: string;
  /** Optional description of the agent's capabilities. */
  description: string | null;
  /** SHA-256 hash of the agent's API key for authentication. */
  apiKeyHash: string;
  /** LLM provider used by this agent (e.g. `"claude"`, `"gpt-4"`). */
  llmProvider: string | null;
  /** Current lifecycle status of the agent. */
  status: AgentStatus;
  /** Timestamp when the agent was registered. */
  createdAt: Date;
}

/**
 * Public-facing projection of an agent — safe to expose via API responses.
 *
 * @remarks
 * Omits `apiKeyHash`, `userId`, and any sensitive credentials.
 */
export interface AgentPublic {
  /** Unique internal identifier. */
  id: string;
  /** Human-readable display name for the agent. */
  name: string;
  /** Optional description of the agent's capabilities. */
  description: string | null;
  /** LLM provider used by this agent. */
  llmProvider: string | null;
  /** Current lifecycle status of the agent. */
  status: AgentStatus;
  /** Timestamp when the agent was registered. */
  createdAt: Date;
}

/**
 * Input payload for registering a new agent.
 *
 * @remarks
 * `e2bApiKey` and `flyApiToken` are optional — when provided they are
 * stored on the owning user record and enable user-hosted deployments.
 */
export interface RegisterAgentInput {
  /** Desired display name for the agent. */
  name: string;
  /** Optional description of the agent's purpose or capabilities. */
  description?: string;
  /** LLM provider identifier (e.g. `"claude"`, `"gpt-4o"`). */
  llmProvider?: string;
  /** E2B API key to store against the owning user. */
  e2bApiKey?: string;
  /** Fly.io API token to store against the owning user. */
  flyApiToken?: string;
}
