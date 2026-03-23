import Redis from "ioredis";

/**
 * Creates a Redis client connected to the given URL.
 * Configured with retry logic and lazy connect to avoid crashing on startup
 * if Redis is temporarily unavailable.
 * @param redisUrl - Redis connection URI (e.g. redis://localhost:6379).
 * @returns A configured ioredis Redis instance.
 */
export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}
