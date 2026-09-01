import { beforeEach, describe, expect, it, vi } from "vitest";
import limitsFixture from "./fixtures/kotak/limits.json";
import type { TradeSessionCredentials } from "@/server/kotak/auth";

const { kotakFetch } = vi.hoisted(() => ({
  kotakFetch: vi.fn(),
}));

vi.mock("@/server/kotak/client", () => ({
  kotakFetch,
}));

vi.mock("@/server/kotak/rate-limit", () => ({
  getKotakRateLimiter: () => ({
    schedule: <T>(task: () => Promise<T>) => task(),
  }),
}));

import { fetchUsedMargin, parseUsedMargin } from "@/server/kotak/limits";

const session: TradeSessionCredentials = {
  accessToken: "access",
  tradingToken: "trade",
  tradingSid: "sid",
  baseUrl: "https://example.kotaksecurities.com",
  neoFinKey: "neo",
  serverId: "server-1",
};

describe("parseUsedMargin", () => {
  it("reads the exact broker MarginUsed field", () => {
    expect(parseUsedMargin(limitsFixture)).toBe(286450.75);
  });

  it("accepts a data-wrapped response", () => {
    expect(parseUsedMargin({ data: { MarginUsed: 0, stat: "Ok" } })).toBe(0);
  });

  it("does not substitute a related margin field", () => {
    expect(() =>
      parseUsedMargin({ MarginUsedPrsnt: "123.45", stat: "Ok" }),
    ).toThrow("Unexpected limits response shape");
  });

  it("throws when the broker reports a failure", () => {
    expect(() =>
      parseUsedMargin({ stat: "Not_Ok", errMsg: "Limits unavailable" }),
    ).toThrow("Limits unavailable");
  });
});

describe("fetchUsedMargin", () => {
  beforeEach(() => {
    kotakFetch.mockReset();
  });

  it("requests all account limits with the trading session", async () => {
    kotakFetch.mockResolvedValue(limitsFixture);

    await expect(fetchUsedMargin(session)).resolves.toBe(286450.75);

    expect(kotakFetch).toHaveBeenCalledWith(
      "https://example.kotaksecurities.com/quick/user/limits?sId=server-1",
      {
        method: "POST",
        bodyEncoding: "form",
        headers: {
          Auth: "trade",
          Sid: "sid",
          "neo-fin-key": "neo",
        },
        body: {
          seg: "ALL",
          exch: "ALL",
          prod: "ALL",
        },
      },
    );
  });

  it("requires a Kotak server ID on live sessions", async () => {
    await expect(
      fetchUsedMargin({
        ...session,
        serverId: undefined,
      }),
    ).rejects.toThrow("missing the Kotak server ID");
  });
});
