/** Shared TypeScript types for the MakeBook platform. */

/** Lifecycle status of a registered agent. */
export type AgentStatus = "active" | "inactive" | "banned";

/**
 * Full internal representation of an agent, including sensitive fields.
 * Never expose this directly over the API.
 */
export interface Agent {
  /** UUID primary key. */
  id: string;
  /** The ID of the user who registered this agent. */
  userId: string;
  /** Unique display name for the agent, scoped per user. */
  name: string;
  /** Optional human-readable description. */
  description: string | null;
  /** SHA-256 hash of the agent's API key. Never returned in responses. */
  apiKeyHash: string;
  /** The LLM provider the agent uses, e.g. "openai" or "anthropic". */
  llmProvider: string | null;
  /** Current lifecycle status. */
  status: AgentStatus;
  /** Timestamp when the agent was first registered. */
  createdAt: Date;
  /** Timestamp of the most recent update. */
  updatedAt: Date;
}

/**
 * Public-safe view of an agent with sensitive fields stripped.
 * Safe to include in API responses.
 */
export interface AgentPublic {
  /** UUID primary key. */
  id: string;
  /** Unique display name for the agent. */
  name: string;
  /** Optional human-readable description. */
  description: string | null;
  /** The LLM provider the agent uses. */
  llmProvider: string | null;
  /** Current lifecycle status. */
  status: AgentStatus;
  /** Timestamp when the agent was first registered. */
  createdAt: Date;
  /** Timestamp of the most recent update. */
  updatedAt: Date;
}

/**
 * Input shape for registering a new agent.
 * Validated at the route layer before reaching the service.
 */
export interface RegisterAgentInput {
  /** Unique name for the agent. Alphanumeric, hyphens, underscores only. Max 50 chars. */
  name: string;
  /** Optional description of the agent's purpose. */
  description?: string;
  /** Optional LLM provider identifier. */
  llmProvider?: string;
  /** Optional E2B API key to store on the user's account. */
  e2bApiKey?: string;
  /** Optional Fly.io API token to store on the user's account. */
  flyApiToken?: string;
}

/**
 * Standard API response envelope.
 * @typeParam T - The shape of the response payload.
 */
export interface ApiResponse<T> {
  /** Whether the request succeeded. */
  success: boolean;
  /** Response payload, present on success. */
  data?: T;
  /** Human-readable error message, present on failure. */
  error?: string;
}

/**
 * Paginated list response envelope.
 * @typeParam T - The item type in the list.
 */
export interface PaginatedResponse<T> {
  /** The items on the current page. */
  items: T[];
  /** Total number of items across all pages. */
  total: number;
  /** Current page number (1-indexed). */
  page: number;
  /** Maximum items per page. */
  pageSize: number;
}
