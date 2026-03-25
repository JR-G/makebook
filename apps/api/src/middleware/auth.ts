import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";

/** SQL query to look up an active agent by their hashed API key. */
const AGENT_LOOKUP_SQL =
  "SELECT id, name FROM agents WHERE api_key_hash = $1 AND status = 'active'";

/**
 * Extracts the Bearer token from an Authorization header value.
 * @param authHeader - The raw Authorization header string.
 * @returns The token string, or null if the header is missing or malformed.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length);
}

/**
 * Hashes an API key with SHA-256 for safe storage and comparison.
 * @param apiKey - The raw API key string.
 * @returns The hex-encoded SHA-256 digest.
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Middleware factory that validates Bearer tokens against the agents table.
 * Attaches the matching agent to `request.agent` on success.
 * Responds with 401 Unauthorized if the token is missing or invalid.
 * @param pool - The PostgreSQL connection pool to query agents from.
 * @returns An Express RequestHandler.
 */
export function authenticateAgent(pool: Pool): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const token = extractBearerToken(request.headers.authorization);

    if (token === null) {
      response.status(401).json({ error: "Unauthorised" });
      return;
    }

    const hash = hashApiKey(token);

    try {
      const result = await pool.query<{ id: string; name: string }>(
        AGENT_LOOKUP_SQL,
        [hash],
      );

      if (result.rows.length === 0) {
        response.status(401).json({ error: "Invalid API key" });
        return;
      }

      request.agent = result.rows[0] as { id: string; name: string };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Expected shape of a decoded user JWT payload. */
interface UserJwtPayload {
  /** User UUID. */
  sub: string;
  /** User email address. */
  email: string;
  /** Expiry timestamp (Unix seconds). */
  exp?: number;
}

/**
 * Verifies an HS256 JWT and returns its decoded payload, or null if invalid.
 * @param token - The raw JWT string.
 * @param secret - The HMAC-SHA256 signing secret.
 * @returns The decoded payload, or null if the token is invalid or expired.
 */
function verifyUserJwt(
  token: string,
  secret: string,
): UserJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(encodedSignature);

  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return null;
  }

  let payload: UserJwtPayload;
  try {
    const json = Buffer.from(encodedPayload, "base64url").toString("utf8");
    payload = JSON.parse(json) as UserJwtPayload;
  } catch {
    return null;
  }

  if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (!payload.sub || !payload.email) {
    return null;
  }

  return payload;
}

/**
 * Middleware factory that validates Bearer JWTs for human users.
 * Attaches the decoded user identity to `request.user` on success.
 * Responds with 401 Unauthorized if the token is missing or invalid.
 * @param secret - The HMAC-SHA256 secret used to sign user JWTs.
 * @returns An Express RequestHandler.
 */
export function authenticateUser(secret: string): RequestHandler {
  return (
    request: Request,
    response: Response,
    next: NextFunction,
  ): void => {
    const token = extractBearerToken(request.headers.authorization);

    if (token === null) {
      response.status(401).json({ error: "Unauthorised" });
      return;
    }

    const payload = verifyUserJwt(token, secret);

    if (payload === null) {
      response.status(401).json({ error: "Invalid token" });
      return;
    }

    request.user = { id: payload.sub, email: payload.email };
    next();
  };
}
