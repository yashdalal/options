import { getRedis, isRedisConfigured } from "./redis";
import { logError, logWarn } from "./logging";
import type { AggregateSession } from "./session";

export const SESSION_TTL_SECONDS = 60 * 60 * 12;

const MEMORY_KEY = "__nearExpirySessionMemory";

type MemoryStore = Map<string, AggregateSession>;

function getMemoryStore(): MemoryStore {
  const globalStore = globalThis as typeof globalThis & {
    [MEMORY_KEY]?: MemoryStore;
  };
  if (!globalStore[MEMORY_KEY]) {
    globalStore[MEMORY_KEY] = new Map();
  }
  return globalStore[MEMORY_KEY];
}

function sessionKey(sessionId: string): string {
  return `near-expiry:session:${sessionId}`;
}

let warnedAboutMemoryFallback = false;

function warnMemoryFallbackOnce(): void {
  if (warnedAboutMemoryFallback) {
    return;
  }
  warnedAboutMemoryFallback = true;
  if (process.env.VERCEL) {
    logError(
      "Upstash Redis is not configured on Vercel; sessions cannot be shared across instances",
    );
    return;
  }
  logWarn(
    "Upstash Redis is not configured; using in-process session memory (fine for local single-process)",
  );
}

export function resetSessionStoreForTests(): void {
  getMemoryStore().clear();
  warnedAboutMemoryFallback = false;
}

export async function readSession(
  sessionId: string,
): Promise<AggregateSession | null> {
  const redis = getRedis();
  if (!redis) {
    warnMemoryFallbackOnce();
    if (process.env.VERCEL && !isRedisConfigured()) {
      throw Object.assign(
        new Error(
          "Upstash Redis is required on Vercel. Connect the Upstash Redis integration and redeploy.",
        ),
        { status: 500, code: "session_store_unavailable" },
      );
    }
    return getMemoryStore().get(sessionId) ?? null;
  }

  try {
    const value = await redis.get<AggregateSession>(sessionKey(sessionId));
    return value ?? null;
  } catch (error) {
    logError("Failed to read session from Redis", {
      sessionId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw Object.assign(new Error("Session store unavailable"), {
      status: 500,
      code: "session_store_unavailable",
      cause: error,
    });
  }
}

export async function writeSession(session: AggregateSession): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    warnMemoryFallbackOnce();
    if (process.env.VERCEL && !isRedisConfigured()) {
      throw Object.assign(
        new Error(
          "Upstash Redis is required on Vercel. Connect the Upstash Redis integration and redeploy.",
        ),
        { status: 500, code: "session_store_unavailable" },
      );
    }
    getMemoryStore().set(session.id, session);
    return;
  }

  try {
    await redis.set(sessionKey(session.id), session, {
      ex: SESSION_TTL_SECONDS,
    });
  } catch (error) {
    logError("Failed to write session to Redis", {
      sessionId: session.id,
      message: error instanceof Error ? error.message : String(error),
    });
    throw Object.assign(new Error("Session store unavailable"), {
      status: 500,
      code: "session_store_unavailable",
      cause: error,
    });
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    getMemoryStore().delete(sessionId);
    return;
  }

  try {
    await redis.del(sessionKey(sessionId));
  } catch (error) {
    logError("Failed to delete session from Redis", {
      sessionId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw Object.assign(new Error("Session store unavailable"), {
      status: 500,
      code: "session_store_unavailable",
      cause: error,
    });
  }
}
