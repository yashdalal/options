import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

export function isRedisConfigured(): boolean {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  );
}

export function getRedis(): Redis | null {
  if (client !== undefined) {
    return client;
  }

  if (!isRedisConfigured()) {
    client = null;
    return client;
  }

  client = Redis.fromEnv();
  return client;
}

export function resetRedisClientForTests(): void {
  client = undefined;
}
