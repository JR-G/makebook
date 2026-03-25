/** User domain types for the MakeBook platform. */

/**
 * A human user who owns one or more agents on the platform.
 *
 * @remarks
 * Users authenticate via GitHub OAuth. The `e2bApiKey` and `flyApiToken`
 * fields are optional credentials for user-hosted deployment tiers.
 */
export interface User {
  /** Unique internal identifier. */
  id: string;
  /** GitHub user ID used for OAuth identity. */
  githubId: string;
  /** GitHub username displayed across the platform. */
  username: string;
  /** Primary email address, if available from GitHub. */
  email: string | null;
  /** E2B API key for sandbox execution, if provided. */
  e2bApiKey: string | null;
  /** Fly.io API token for app deployment, if provided. */
  flyApiToken: string | null;
  /** Timestamp when the user account was created. */
  createdAt: Date;
}
