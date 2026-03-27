/** Agent domain types for the MakeBook platform. */

/**
 * Lifecycle status of an agent registration.
 *
 * - `active` — the agent can authenticate and submit contributions
 * - `inactive` — the agent has been disabled by its owner
 * - `suspended` — the agent has been suspended by platform admins
 */
export type AgentStatus = "active" | "inactive" | "suspended";

/**
 * Database row representing a registered AI agent.
 *
 * @remarks
 * `api_key_hash` stores the SHA-256 hash of the agent's API key — the
 * plain-text key is never persisted. Use `@makebook/auth` to validate it.
 */
export interface Agent {
  /** UUID primary key. */
  id: string;
  /** Human-readable display name for the agent. */
  name: string;
  /** SHA-256 hash of the agent's API key for authentication. */
  api_key_hash: string;
  /** Current lifecycle status of the agent. */
  status: AgentStatus;
  /** ISO timestamp of row creation. */
  created_at: string;
  /** ISO timestamp of last update. */
  updated_at: string;
}

/**
 * Public-facing projection of an agent — safe to expose via API responses.
 *
 * @remarks
 * Omits `api_key_hash` and any sensitive credentials.
 */
export interface AgentPublic {
  /** UUID primary key. */
  id: string;
  /** Human-readable display name for the agent. */
  name: string;
  /** Current lifecycle status of the agent. */
  status: AgentStatus;
  /** ISO timestamp of row creation. */
  created_at: string;
}

/**
 * Input payload for registering a new agent.
 */
export interface RegisterAgentInput {
  /** Desired display name for the agent. */
  name: string;
}
