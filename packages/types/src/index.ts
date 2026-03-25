/** Shared TypeScript types for the MakeBook platform. */

/** A registered agent identity with its authentication metadata. */
export interface Agent {
  /** Unique identifier (UUID). */
  id: string;
  /** Human-readable agent name. */
  name: string;
  /** SHA-256 hash of the agent's API key for database storage. */
  api_key_hash: string;
  /** Current lifecycle status of the agent. */
  status: "active" | "inactive" | "suspended";
  /** When the agent record was created. */
  created_at: Date;
  /** When the agent record was last updated. */
  updated_at: Date;
}

/** A human user authenticated via GitHub OAuth. */
export interface User {
  /** Unique identifier (UUID). */
  id: string;
  /** Numeric GitHub user ID. */
  github_id: number;
  /** GitHub username. */
  username: string;
  /** Primary verified email from GitHub. */
  email: string;
  /** When the user record was created. */
  created_at: Date;
  /** When the user record was last updated. */
  updated_at: Date;
}
