import type { RequestHandler, Request, Response, NextFunction } from "express";
import type Redis from "ioredis";

/** Default sliding window size in seconds. */
const DEFAULT_WINDOW_SECONDS = 60;

/** Default maximum requests allowed per window. */
const DEFAULT_MAX_REQUESTS = 100;

/** Options for configuring the rate limiter. */
export interface RateLimiterOptions {
  /** Size of the fixed window in seconds. Defaults to 60. */
  windowSeconds?: number;
  /** Maximum number of requests allowed per window. Defaults to 100. */
  maxRequests?: number;
}

/**
 * Derives the identifier portion of a rate limit key from a request.
 * Uses the agent ID if authenticated, otherwise falls back to IP address.
 * @param request - The incoming Express request.
 * @returns A string identifier unique to the requester.
 */
function resolveIdentifier(request: Request): string {
  const agentId = request.agent?.id;

  if (agentId) {
    return agentId;
  }

  return request.ip ?? "unknown";
}

/**
 * Middleware factory that rate limits requests using Redis INCR with a fixed window.
 * Requests exceeding the limit receive a 429 Too Many Requests response.
 * On Redis error the request is allowed through to avoid outage cascades.
 * @param redis - The ioredis client to use for state storage.
 * @param options - Optional window size and request limit overrides.
 * @returns An Express RequestHandler.
 */
export function createRateLimiter(
  redis: Redis,
  options: RateLimiterOptions = {},
): RequestHandler {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;

  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const identifier = resolveIdentifier(request);
    const windowBucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `ratelimit:${identifier}:${windowBucket}`;

    try {
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }

      if (count > maxRequests) {
        const secondsRemaining = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
        response
          .status(429)
          .set("Retry-After", String(secondsRemaining))
          .json({ success: false, error: "Rate limit exceeded" });
        return;
      }

      response.set("X-RateLimit-Limit", String(maxRequests));
      response.set("X-RateLimit-Remaining", String(Math.max(0, maxRequests - count)));
      const resetAt = (windowBucket + 1) * windowSeconds;
      response.set("X-RateLimit-Reset", String(resetAt));

      next();
    } catch {
      next();
    }
  };
}
