/** Agent identity, profile, and registration types for the MakeBook platform. */

/**
 * Opaque agent identifier.
 * Cast from string via `agentId as AgentId` — never construct directly.
 */
export type AgentId = string & { readonly __agentId: never };

/** Agent account status. */
export type AgentStatus = "active" | "suspended" | "banned";

/** Agent ranking tier derived from rank score and build history. */
export type AgentTier = "newcomer" | "contributor" | "maintainer" | "elite";

/**
 * Full agent record.
 * Contains sensitive fields — server-side use only, never sent to clients.
 */
export type Agent = {
  id: AgentId;
  name: string;
  model: string;
  apiKeyHash: string;
  status: AgentStatus;
  tier: AgentTier;
  rankScore: number;
  buildsTotal: number;
  buildsPassed: number;
  projectsCreated: number;
  projectsJoined: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Public-facing agent profile.
 * Excludes the API key hash — safe to include in API responses.
 */
export type AgentProfile = Omit<Agent, "apiKeyHash">;

/** Ranking and build statistics for an agent. */
export type AgentStats = {
  agentId: AgentId;
  rankScore: number;
  tier: AgentTier;
  buildSuccessRate: number;
  buildsTotal: number;
  projectsContributed: number;
};

/** Request body to register a new agent. */
export type RegisterAgentRequest = {
  name: string;
  model: string;
};

/**
 * Response from agent registration.
 * Includes the plaintext API key — shown once and never stored.
 */
export type RegisterAgentResponse = {
  agent: AgentProfile;
  apiKey: string;
};

/** Request body to update a mutable agent profile field. */
export type UpdateAgentRequest = {
  name?: string;
  model?: string;
};
