import { Redis } from "@upstash/redis";
import { isDemoMode } from "./demo/mode";

let client: Redis | null | undefined;

/** Demo mode never touches Redis: `.env.local` may hold production keys shared with the live site. */
export function isRedisConfigured(): boolean {
  if (isDemoMode()) {
    return false;
  }
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
