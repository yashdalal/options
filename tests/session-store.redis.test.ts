import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregateSession } from "@/server/session";
import { ACCOUNT_DEFINITIONS } from "@/config/accounts";

const redisGet = vi.fn();
const redisSet = vi.fn();
const redisDel = vi.fn();

vi.mock("@/server/redis", () => ({
  isRedisConfigured: () => true,
  getRedis: () => ({
    get: redisGet,
    set: redisSet,
    del: redisDel,
  }),
  resetRedisClientForTests: () => undefined,
}));

function sampleSession(id = "session-1"): AggregateSession {
  const accounts = {} as AggregateSession["accounts"];
  for (const definition of ACCOUNT_DEFINITIONS) {
    accounts[definition.id] = {
      accountId: definition.id,
      label: definition.label,
      status: "disconnected",
      credentials: null,
    };
  }
  return {
    id,
    createdAt: 1,
    accounts,
  };
}

describe("redis-backed session store", () => {
  beforeEach(async () => {
    vi.resetModules();
    redisGet.mockReset();
    redisSet.mockReset();
    redisDel.mockReset();
    const { resetSessionStoreForTests } = await import("@/server/session-store");
    resetSessionStoreForTests();
  });

  it("reads and writes sessions through Redis with TTL", async () => {
    const store = await import("@/server/session-store");
    const session = sampleSession();
    redisSet.mockResolvedValue("OK");
    redisGet.mockResolvedValue(session);

    await store.writeSession(session);
    expect(redisSet).toHaveBeenCalledWith(
      "near-expiry:session:session-1",
      session,
      { ex: store.SESSION_TTL_SECONDS },
    );

    await expect(store.readSession("session-1")).resolves.toEqual(session);
    expect(redisGet).toHaveBeenCalledWith("near-expiry:session:session-1");
  });

  it("deletes sessions from Redis", async () => {
    const store = await import("@/server/session-store");
    redisDel.mockResolvedValue(1);
    await store.deleteSession("session-1");
    expect(redisDel).toHaveBeenCalledWith("near-expiry:session:session-1");
  });

  it("fails visibly when Redis throws", async () => {
    const store = await import("@/server/session-store");
    redisGet.mockRejectedValue(new Error("upstash down"));
    await expect(store.readSession("session-1")).rejects.toMatchObject({
      code: "session_store_unavailable",
      status: 500,
    });
  });
});
