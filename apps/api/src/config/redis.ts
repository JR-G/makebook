import Redis from "ioredis";

/**
 * Creates a Redis client connected to the given URL.
 * Configured with no per-request retries and ready-check disabled for predictable
 * startup behaviour. Attaches error and connect handlers to stderr/stdout.
 * @param redisUrl - Redis connection URI (e.g. redis://localhost:6379).
 * @returns A configured ioredis Redis instance.
 */
export function createRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  client.on("error", (error: Error) => {
    process.stderr.write(`Redis client error: ${error.message}\n`);
  });

  client.on("connect", () => {
    process.stdout.write("Redis client connected\n");
  });

  return client;
}
