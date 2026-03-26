import type { RequestHandler, Request, Response, NextFunction } from "express";
import type Redis from "ioredis";

/** Default sliding window size in seconds. */
const DEFAULT_WINDOW_SECONDS = 60;

/** Default maximum requests allowed per window. */
const DEFAULT_MAX_REQUESTS = 100;

/** Options for configuring the rate limiter. */
export interface RateLimitOptions {
  /** Size of the sliding window in seconds. Defaults to 60. */
  windowSeconds?: number;
  /** Maximum number of requests allowed per window. Defaults to 100. */
  maxRequests?: number;
}

/**
 * Lua script for atomic sliding window rate limiting.
 * Uses a sorted set keyed by API key. Each member is the request timestamp.
 * Returns 1 if the request is allowed, 0 if the limit is exceeded.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cutoff = now - window_ms
redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, tostring(now) .. ':' .. tostring(math.random(1000000)))
redis.call('PEXPIRE', key, window_ms)
return 1
`;

/**
 * Derives a rate limit key from the client IP address.
 * This global middleware runs before auth, so agent identity is not yet available.
 * Per-agent rate limiting should be applied per-route after {@link authenticateAgent}.
 * @param request - The incoming Express request.
 * @returns A string key unique to the client IP.
 */
function resolveRateLimitKey(request: Request): string {
  const ip = request.ip ?? "unknown";
  return `rate_limit:ip:${ip}`;
}

/**
 * Middleware factory that rate limits requests using a Redis sliding window.
 * Requests exceeding the limit receive a 429 Too Many Requests response.
 * @param redis - The ioredis client to use for state storage.
 * @param options - Optional window size and request limit overrides.
 * @returns An Express RequestHandler.
 */
export function rateLimit(
  redis: Redis,
  options: RateLimitOptions = {},
): RequestHandler {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = windowSeconds * 1_000;

  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = resolveRateLimitKey(request);
    const now = Date.now();

    try {
      const result = await redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        key,
        String(windowMs),
        String(maxRequests),
        String(now),
      );

      if (result === 0) {
        response.status(429).json({ error: "Too many requests" });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
