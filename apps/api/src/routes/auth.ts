import { Router } from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import type { User } from "@makebook/types";
import type { AppConfig } from "../config/index.ts";
import { authenticateUser } from "../middleware/auth.ts";

/** GitHub API and OAuth endpoint URLs. */
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

/** OAuth scope required for profile and email access. */
const GITHUB_SCOPE = "read:user,user:email";

/** Shape of GitHub's access token exchange response. */
interface GitHubTokenResponse {
  access_token: string;
}

/** Shape of GitHub's user profile response. */
interface GitHubProfile {
  id: number;
  login: string;
}

/** Shape of an individual entry from GitHub's emails endpoint. */
interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** SQL to upsert a user on GitHub OAuth login. */
const UPSERT_USER_SQL =
  "INSERT INTO users (github_id, username, email) VALUES ($1, $2, $3) " +
  "ON CONFLICT (github_id) DO UPDATE SET username = $2, email = $3 RETURNING *";

export const authRouter = Router();

/**
 * Redirects the browser to GitHub's OAuth authorisation page.
 *
 * @remarks
 * Builds the GitHub OAuth URL with `client_id`, `redirect_uri`, and
 * the required scopes, then issues a redirect response.
 */
authRouter.get("/github", (req, res): void => {
  const config = req.app.locals["config"] as AppConfig;
  const callbackUrl = buildCallbackUrl(req.protocol, req.get("host") ?? "");

  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.githubClientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", GITHUB_SCOPE);

  res.redirect(url.toString());
});

/**
 * Handles the GitHub OAuth callback, exchanging the code for a JWT.
 *
 * @remarks
 * Exchanges the OAuth code for a GitHub access token, fetches the
 * user's profile and primary verified email, upserts the user record,
 * and returns a signed JWT alongside the user's public fields.
 */
authRouter.get("/github/callback", async (req, res, next): Promise<void> => {
  const code = req.query["code"];

  if (typeof code !== "string") {
    res.status(400).json({ success: false, error: "Missing code parameter" });
    return;
  }

  const config = req.app.locals["config"] as AppConfig;
  const callbackUrl = buildCallbackUrl(req.protocol, req.get("host") ?? "");

  try {
    const accessToken = await exchangeCodeForToken(
      code,
      config.githubClientId,
      config.githubClientSecret,
      callbackUrl,
    );

    const [profile, emails] = await Promise.all([
      fetchGitHubProfile(accessToken),
      fetchGitHubEmails(accessToken),
    ]);

    const primaryEmail = emails.find(
      (entry) => entry.primary && entry.verified,
    );

    if (primaryEmail === undefined) {
      res
        .status(400)
        .json({ success: false, error: "No verified primary email on GitHub account" });
      return;
    }

    const pool = req.app.locals["pool"] as Pool;
    const result = await pool.query<User>(UPSERT_USER_SQL, [
      profile.id,
      profile.login,
      primaryEmail.email,
    ]);

    const user = result.rows[0];

    if (user === undefined) {
      res.status(500).json({ success: false, error: "Failed to upsert user" });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      config.jwtSecret,
      { expiresIn: "7d" },
    );

    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, username: user.username, email: user.email },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Returns the authenticated user's profile.
 *
 * @remarks
 * Requires a valid JWT via the `authenticateUser` middleware.
 * Returns the full user record from `req.user`.
 */
authRouter.get("/me", authenticateUser(), (req, res): void => {
  res.json({ success: true, data: req.user });
});

/**
 * Constructs the OAuth callback URL from the current request context.
 * @param protocol - The request protocol (http or https).
 * @param host - The request host header value.
 * @returns The absolute callback URL string.
 */
function buildCallbackUrl(protocol: string, host: string): string {
  return `${protocol}://${host}/auth/github/callback`;
}

/**
 * Exchanges a GitHub OAuth code for an access token.
 * @param code - The authorization code from GitHub.
 * @param clientId - The GitHub OAuth app client ID.
 * @param clientSecret - The GitHub OAuth app client secret.
 * @param redirectUri - The callback URL registered with the OAuth app.
 * @returns The GitHub access token string.
 */
async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await response.json()) as GitHubTokenResponse;
  return data.access_token;
}

/**
 * Fetches the authenticated user's GitHub profile.
 * @param accessToken - A valid GitHub OAuth access token.
 * @returns The user's GitHub profile (id and login).
 */
async function fetchGitHubProfile(accessToken: string): Promise<GitHubProfile> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await response.json()) as GitHubProfile;
}

/**
 * Fetches the authenticated user's GitHub email addresses.
 * @param accessToken - A valid GitHub OAuth access token.
 * @returns An array of the user's GitHub email objects.
 */
async function fetchGitHubEmails(accessToken: string): Promise<GitHubEmail[]> {
  const response = await fetch(GITHUB_EMAILS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await response.json()) as GitHubEmail[];
}
