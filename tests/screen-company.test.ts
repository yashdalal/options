import { describe, expect, it } from "vitest";
import type { ScreenCandidate } from "@/domain/types";
import {
  companiesForExpiry,
  enrichCandidatesWithMargins,
  filterQualifyingCandidates,
  listUniqueExpiries,
  runPool,
} from "@/lib/screen-company";

function candidate(partial: Partial<ScreenCandidate> & { id: string }): ScreenCandidate {
  return {
    company: "RELIANCE",
    optionType: "CALL",
    strike: 3000,
    spot: 2500,
    spreadPct: 20,
    priceDiffInr: 500,
    premium: 10,
    hasBid: true,
    lotSize: 250,
    lots: 1,
    fillIndex: 0,
    netPremium: 2000,
    calendarDaysLeft: 30,
    expiryIso: "2026-08-28",
    instrumentToken: "123",
    exchangeSegment: "nse_fo",
    tradingSymbol: "RELIANCE28AUG263000CE",
    margin: null,
    annualizedReturnPct: null,
    meetsSpread: true,
    meetsReturn: null,
    ...partial,
  };
}

describe("companiesForExpiry", () => {
  it("keeps only underlyings that list the selected expiry", () => {
    const result = companiesForExpiry(
      ["AAA", "BBB", "CCC"],
      {
        AAA: ["2026-08-28", "2026-09-25"],
        BBB: ["2026-09-25"],
        CCC: ["2026-08-28"],
      },
      "2026-08-28",
    );
    expect(result.eligible).toEqual(["AAA", "CCC"]);
    expect(result.skipped).toBe(1);
  });
});

describe("listUniqueExpiries", () => {
  it("returns sorted unique expiries across underlyings", () => {
    expect(
      listUniqueExpiries({
        AAA: ["2026-09-25", "2026-08-28"],
        BBB: ["2026-08-28"],
      }),
    ).toEqual(["2026-08-28", "2026-09-25"]);
  });
});

describe("enrichCandidatesWithMargins", () => {
  it("computes annualized return and meetsReturn from margin results", () => {
    const rows = enrichCandidatesWithMargins(
      [
        candidate({ id: "a", netPremium: 3650, calendarDaysLeft: 365 }),
        candidate({ id: "b", instrumentToken: "999", netPremium: 100, calendarDaysLeft: 30 }),
      ],
      [
        { id: "a", instrumentToken: "123", margin: 10000 },
        { id: "b", instrumentToken: "999", margin: 10000 },
      ],
      24,
    );

    expect(rows[0].annualizedReturnPct).toBeCloseTo(36.5, 5);
    expect(rows[0].meetsReturn).toBe(true);
    expect(rows[1].meetsReturn).toBe(false);
  });
});

describe("filterQualifyingCandidates", () => {
  it("requires both spread and return thresholds", () => {
    const rows = filterQualifyingCandidates([
      candidate({ id: "1", meetsSpread: true, meetsReturn: true }),
      candidate({ id: "2", meetsSpread: true, meetsReturn: false }),
      candidate({ id: "3", meetsSpread: false, meetsReturn: true }),
      candidate({ id: "4", meetsSpread: true, meetsReturn: null }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["1"]);
  });
});

describe("runPool", () => {
  it("runs work with bounded concurrency and preserves order", async () => {
    const started: number[] = [];
    const active: number[] = [];
    let maxActive = 0;

    const results = await runPool([1, 2, 3, 4], 2, async (value) => {
      started.push(value);
      active.push(value);
      maxActive = Math.max(maxActive, active.length);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active.splice(active.indexOf(value), 1);
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(started).toHaveLength(4);
  });

  it("aborts when the signal is cancelled", async () => {
    const controller = new AbortController();
    const promise = runPool(
      [1, 2, 3, 4, 5],
      1,
      async (value) => {
        if (value === 2) {
          controller.abort();
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return value;
      },
      controller.signal,
    );

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
