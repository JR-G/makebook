/** User domain types for the MakeBook platform. */

/**
 * Database row representing a human user authenticated via GitHub OAuth.
 */
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
