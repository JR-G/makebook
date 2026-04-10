import Redis from "ioredis";

const REDIS_RETRY_COUNT = null;
const REDIS_READY_CHECK = false;

/**
 * Creates a Redis client connected to the given URL.
 * Configured to fail open: no request-level retry limit and ready check disabled
 * to avoid blocking startup when Redis is warming up.
 * @param redisUrl - Redis connection URI (e.g. redis://localhost:6379).
 * @returns A configured ioredis Redis instance.
 */
export function createRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: REDIS_RETRY_COUNT,
    enableReadyCheck: REDIS_READY_CHECK,
    lazyConnect: true,
  });

  client.on("error", (error: Error) => {
    process.stderr.write(`Redis error: ${error.message}\n`);
  });

  client.on("connect", () => {
    process.stdout.write("Redis connected\n");
  });

  return client;
}
