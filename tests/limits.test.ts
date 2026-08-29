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
};

describe("parseUsedMargin", () => {
  it("reads the exact broker MarginUsed field", () => {
    expect(parseUsedMargin(limitsFixture)).toEqual({
      usedMargin: 286450.75,
      brokerUpdatedAt: "2026-08-29T14:00:00.000Z",
    });
  });

  it("accepts a data-wrapped response", () => {
    expect(parseUsedMargin({ data: { MarginUsed: 0, stat: "Ok" } })).toEqual({
      usedMargin: 0,
      brokerUpdatedAt: null,
    });
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

    await expect(fetchUsedMargin(session)).resolves.toMatchObject({
      usedMargin: 286450.75,
    });

    expect(kotakFetch).toHaveBeenCalledWith(
      "https://example.kotaksecurities.com/quick/user/limits?segment=ALL&exchange=ALL&product=ALL",
      {
        method: "GET",
        headers: {
          Auth: "trade",
          Sid: "sid",
          "neo-fin-key": "neo",
        },
      },
    );
  });
});
