import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DEFINITIONS } from "@/config/accounts";
import { resetEnvCacheForTests } from "@/config/env";
import { resetDemoUniverseForTests } from "@/server/demo/data/universe";
import { isDemoMode } from "@/server/demo/mode";
import { resetSessionStoreForTests } from "@/server/session-store";
import { resetRedisClientForTests } from "@/server/redis";
import { resetSpanStoreForTests } from "@/server/span/store";

describe("demo mode", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DEMO_MODE;
    delete process.env.VERCEL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    resetEnvCacheForTests();
    resetDemoUniverseForTests();
    resetSessionStoreForTests();
    resetRedisClientForTests();
    resetSpanStoreForTests();
  });

  afterEach(() => {
    delete process.env.DEMO_MODE;
    resetEnvCacheForTests();
    resetDemoUniverseForTests();
  });

  it("isDemoMode requires DEMO_MODE and non-production", async () => {
    expect(isDemoMode()).toBe(false);

    process.env.DEMO_MODE = "1";
    expect(isDemoMode()).toBe(process.env.NODE_ENV !== "production");

    process.env.DEMO_MODE = "true";
    expect(isDemoMode()).toBe(process.env.NODE_ENV !== "production");

    process.env.DEMO_MODE = "0";
    expect(isDemoMode()).toBe(false);
  });

  it("isDemoMode stays off in production even with DEMO_MODE=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "1");
    expect(isDemoMode()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("seeds a ready demo session without TOTP", async () => {
    process.env.DEMO_MODE = "1";
    resetEnvCacheForTests();

    const { ensureDemoSession } = await import("@/server/demo/session");
    const { requireConnectedAccounts } = await import("@/server/session");

    const sessionId = await ensureDemoSession();
    const credentials = await requireConnectedAccounts(sessionId);

    expect(ACCOUNT_DEFINITIONS.every((definition) => credentials[definition.id])).toBe(
      true,
    );
    expect(credentials.prakash.tradingToken).toContain("demo-trade");
  });

  it("hasKotakCredentials is true in demo without real secrets", async () => {
    process.env.DEMO_MODE = "1";
    resetEnvCacheForTests();
    const { hasKotakCredentials } = await import("@/config/env");
    expect(hasKotakCredentials()).toBe(true);
  });

  it("demo adapters return positions and quotes that normalize", async () => {
    process.env.DEMO_MODE = "1";
    resetEnvCacheForTests();

    const { demoTradeCredentials } = await import("@/server/demo/session");
    const { fetchPositions } = await import("@/server/kotak/positions");
    const { fetchQuotes } = await import("@/server/kotak/quotes");
    const { loadScripMasterRegistry } = await import("@/server/kotak/scrip-master");
    const { getDemoUniverse } = await import("@/server/demo/data/universe");
    const { refreshSpanSnapshot } = await import("@/server/span/fetch");

    const session = demoTradeCredentials("prakash");
    const positions = await fetchPositions(session, "test", "prakash");
    expect(positions.length).toBeGreaterThan(0);
    expect(positions[0].sym).toBeTruthy();

    const registry = await loadScripMasterRegistry(session);
    expect(registry.optionUnderlyings).toContain("SBIN");
    expect(registry.optionUnderlyings).toContain("ASHOKLEY");

    const fo = getDemoUniverse().options.slice(0, 5).map((option) => ({
      instrumentToken: option.instrumentToken,
      exchangeSegment: option.exchangeSegment,
    }));
    const quotes = await fetchQuotes(session, fo);
    expect(quotes).toHaveLength(fo.length);
    expect(quotes.every((quote) => quote.ltp !== null && quote.bestBid !== null)).toBe(
      true,
    );
    expect(quotes[0].buyDepth.length).toBeGreaterThan(0);

    const spanMeta = await refreshSpanSnapshot({ force: true });
    expect(spanMeta.variant).toBe("demo");
    expect(spanMeta.underlyingCount).toBeGreaterThan(0);
  });

  it("builds monitor and screen snapshots from demo adapters", async () => {
    process.env.DEMO_MODE = "1";
    resetEnvCacheForTests();

    const { ensureDemoSession } = await import("@/server/demo/session");
    const { requireConnectedAccounts } = await import("@/server/session");
    const { getMonitorSnapshot } = await import("@/server/monitor");
    const { getScreenSnapshot } = await import("@/server/screen");

    const sessionId = await ensureDemoSession();
    const sessions = await requireConnectedAccounts(sessionId);
    const monitor = await getMonitorSnapshot(sessions, "demo-monitor", sessionId);

    expect(monitor.optionPositionCount).toBeGreaterThan(0);
    expect(monitor.groups.length).toBeGreaterThan(0);
    expect(monitor.missingSymbols).toEqual([]);

    const expiryIso = monitor.groups[0]?.expiryIso;
    expect(expiryIso).toBeTruthy();

    const screen = await getScreenSnapshot(
      sessions,
      {
        symbol: "SBIN",
        expiryIso: expiryIso!,
        side: "BOTH",
        spreadMin: 1,
        returnMin: 0,
        lots: 1,
      },
      "demo-screen",
      sessionId,
    );

    expect(screen.spot).toBeGreaterThan(0);
    expect(screen.candidates.length).toBeGreaterThan(0);
    expect(screen.priceRanges).not.toBeNull();
    expect(screen.boardMeeting).not.toBeNull();
  });
});
