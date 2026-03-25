import { Router } from "express";
import jwt from "jsonwebtoken";
import type { Pool } from "pg";
import type { AppConfig } from "../config/index.ts";
import { authenticateUser } from "../middleware/auth.ts";
import type { User } from "@makebook/types";

const UPSERT_USER_SQL = `
  INSERT INTO users (github_id, username, email)
  VALUES ($1, $2, $3)
  ON CONFLICT (github_id) DO UPDATE SET username = $2, email = $3
  RETURNING *
`;

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

interface GitHubUser {
  id: number;
  login: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GitHubTokenResponse {
  access_token: string;
}

/** Express router for GitHub OAuth and JWT authentication endpoints. */
export const authRouter = Router();

/**
 * Redirects the browser to GitHub's OAuth authorisation page.
 *
 * @remarks
 * Reads `githubClientId`, `githubCallbackUrl` from `req.app.locals.config`
 * and constructs the authorisation URL with the `read:user,user:email` scope.
 */
authRouter.get("/github", (req, res) => {
  const config = req.app.locals["config"] as AppConfig;
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: config.githubCallbackUrl,
    scope: "read:user,user:email",
  });
  res.redirect(`${GITHUB_AUTHORIZE_URL}?${params.toString()}`);
});

/**
 * Handles the GitHub OAuth callback, exchanges the code for a JWT.
 *
 * @remarks
 * - Exchanges `code` for a GitHub access token.
 * - Fetches the user profile and primary verified email from GitHub.
 * - Upserts the user record in the database.
 * - Returns a signed JWT valid for 7 days.
 */
authRouter.get("/github/callback", async (req, res, next) => {
  const { code } = req.query;

  if (typeof code !== "string") {
    res.status(400).json({ success: false, error: "Missing code parameter" });
    return;
  }

  try {
    const config = req.app.locals["config"] as AppConfig;
    const pool = req.app.locals["pool"] as Pool;

    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
      }),
    });
    const tokenData = (await tokenResponse.json()) as GitHubTokenResponse;
    const accessToken = tokenData.access_token;

    const [userResponse, emailsResponse] = await Promise.all([
      fetch(GITHUB_USER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch(GITHUB_EMAILS_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    const githubUser = (await userResponse.json()) as GitHubUser;
    const emails = (await emailsResponse.json()) as GitHubEmail[];

    const primaryEmail = emails.find(
      (entry) => entry.primary && entry.verified,
    );

    if (!primaryEmail) {
      res
        .status(400)
        .json({ success: false, error: "No verified primary email on GitHub account" });
      return;
    }

    const result = await pool.query<User>(UPSERT_USER_SQL, [
      githubUser.id,
      githubUser.login,
      primaryEmail.email,
    ]);

    const user = result.rows.at(0);

    if (user === undefined) {
      next(new Error("Upsert returned no rows"));
      return;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      config.jwtSecret,
      { expiresIn: "7d" },
    );

    res.status(200).json({
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
 * Returns the currently authenticated user's profile.
 *
 * @remarks
 * Requires a valid JWT in the Authorization header. The `authenticateUser`
 * middleware populates `req.user` before this handler runs.
 */
authRouter.get("/me", authenticateUser(), (req, res) => {
  res.status(200).json({ success: true, data: req.user });
});
