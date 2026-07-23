import { describe, expect, it } from "vitest";
import type { ScreenCandidate } from "@/domain/types";
import {
  companiesForExpiry,
  enrichCandidatesWithMargins,
  filterCompanyChoices,
  filterQualifyingCandidates,
  listExpiriesForSelection,
  listUniqueExpiries,
  runPool,
  selectTopCandidatesBySide,
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

describe("filterCompanyChoices", () => {
  const eligible = ["ACC", "ASIANPAINT", "NIFTY", "RELIANCE", "TCS"];

  it("searches the full eligible list and ranks prefix matches first", () => {
    const result = filterCompanyChoices(eligible, [], "NIF", 2);
    expect(result.matches).toEqual(["NIFTY"]);
    expect(result.truncated).toBe(false);
    expect(result.otherExpiryMatches).toEqual([]);
  });

  it("truncates only the empty-query browse list", () => {
    const result = filterCompanyChoices(eligible, ["ACC"], "", 2);
    expect(result.matches).toEqual(["ASIANPAINT", "NIFTY"]);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(4);
  });

  it("surfaces all near-term expiries for matches on other dates", () => {
    const result = filterCompanyChoices(
      ["RELIANCE", "TCS"],
      [],
      "NIF",
      50,
      ["NIFTY", "RELIANCE", "TCS"],
      {
        NIFTY: ["2026-07-23", "2026-07-30", "2026-08-06", "2026-12-29"],
        RELIANCE: ["2026-07-28"],
        TCS: ["2026-07-28"],
      },
      "2026-07-28",
      new Date("2026-07-23T06:30:00Z"),
    );
    expect(result.matches).toEqual([]);
    expect(result.otherExpiryMatches).toEqual([
      { symbol: "NIFTY", expiryIso: "2026-07-23" },
      { symbol: "NIFTY", expiryIso: "2026-07-30" },
      { symbol: "NIFTY", expiryIso: "2026-08-06" },
    ]);
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

describe("listExpiriesForSelection", () => {
  const byUnderlying = {
    SENSEX: ["2026-07-30", "2026-08-06", "2026-12-29"],
    RELIANCE: ["2026-07-28", "2026-08-28", "2026-12-29", "2027-06-24"],
    TCS: ["2026-07-28", "2026-08-28", "2026-12-29"],
  };
  const now = new Date("2026-07-23T06:30:00Z");

  it("returns near-term unique expiries when nothing is selected", () => {
    expect(listExpiriesForSelection([], byUnderlying, now)).toEqual([
      "2026-07-28",
      "2026-07-30",
      "2026-08-06",
      "2026-08-28",
    ]);
  });

  it("returns only that underlying's near-term expiries for a single selection", () => {
    expect(listExpiriesForSelection(["SENSEX"], byUnderlying, now)).toEqual([
      "2026-07-30",
      "2026-08-06",
    ]);
  });

  it("returns the near-term intersection across multiple selections", () => {
    expect(listExpiriesForSelection(["RELIANCE", "TCS"], byUnderlying, now)).toEqual([
      "2026-07-28",
      "2026-08-28",
    ]);
    expect(listExpiriesForSelection(["SENSEX", "RELIANCE"], byUnderlying, now)).toEqual(
      [],
    );
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

describe("selectTopCandidatesBySide", () => {
  it("keeps the top N calls and puts per company by annualized return", () => {
    const rows = selectTopCandidatesBySide(
      [
        candidate({
          id: "r-ce-1",
          company: "RELIANCE",
          optionType: "CALL",
          strike: 3000,
          annualizedReturnPct: 40,
          meetsReturn: true,
        }),
        candidate({
          id: "r-ce-2",
          company: "RELIANCE",
          optionType: "CALL",
          strike: 3100,
          annualizedReturnPct: 50,
          meetsReturn: true,
        }),
        candidate({
          id: "r-ce-3",
          company: "RELIANCE",
          optionType: "CALL",
          strike: 3200,
          annualizedReturnPct: 30,
          meetsReturn: true,
        }),
        candidate({
          id: "r-ce-4",
          company: "RELIANCE",
          optionType: "CALL",
          strike: 3300,
          annualizedReturnPct: 20,
          meetsReturn: true,
        }),
        candidate({
          id: "r-pe-1",
          company: "RELIANCE",
          optionType: "PUT",
          strike: 2000,
          annualizedReturnPct: 35,
          meetsReturn: true,
        }),
        candidate({
          id: "r-pe-2",
          company: "RELIANCE",
          optionType: "PUT",
          strike: 1900,
          annualizedReturnPct: 45,
          meetsReturn: true,
        }),
        candidate({
          id: "t-ce-1",
          company: "TCS",
          optionType: "CALL",
          strike: 4000,
          annualizedReturnPct: 60,
          meetsReturn: true,
        }),
      ],
      3,
    );

    expect(rows.map((row) => row.id)).toEqual([
      "r-ce-2",
      "r-ce-1",
      "r-ce-3",
      "r-pe-2",
      "r-pe-1",
      "t-ce-1",
    ]);
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
