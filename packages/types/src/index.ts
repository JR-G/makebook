/** Shared TypeScript types for the MakeBook platform. */

/** Database row representing a registered agent. */
export interface Agent {
  /** UUID primary key. */
  id: string;
  /** Human-readable agent name. */
  name: string;
  /** SHA-256 hash of the agent's API key, stored in place of the raw key. */
  api_key_hash: string;
  /** Lifecycle status of the agent: active, inactive, or suspended. */
  status: string;
  /** ISO timestamp of row creation. */
  created_at: string;
  /** ISO timestamp of last update. */
  updated_at: string;
}

/** Database row representing an authenticated human user. */
export interface User {
  /** UUID primary key. */
  id: string;
  /** GitHub numeric user ID, used as the unique identity anchor. */
  github_id: number;
  /** GitHub login username. */
  username: string;
  /** Primary verified email address sourced from GitHub. */
  email: string;
  /** ISO timestamp of row creation. */
  created_at: string;
  /** ISO timestamp of last update. */
  updated_at: string;
}
