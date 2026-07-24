import { describe, expect, it } from "vitest";
import {
  canApplyThresholds,
  filterRowsByThresholds,
  thresholdsEqual,
} from "@/lib/report-threshold-filter";

describe("canApplyThresholds", () => {
  const run = { spreadMin: 8, returnMin: 12 };

  it("allows equal or raised thresholds", () => {
    expect(canApplyThresholds(run, run)).toBe(true);
    expect(canApplyThresholds(run, { spreadMin: 10, returnMin: 12 })).toBe(true);
    expect(canApplyThresholds(run, { spreadMin: 8, returnMin: 15 })).toBe(true);
    expect(canApplyThresholds(run, { spreadMin: 10, returnMin: 15 })).toBe(true);
  });

  it("rejects any loosened threshold", () => {
    expect(canApplyThresholds(run, { spreadMin: 7, returnMin: 12 })).toBe(false);
    expect(canApplyThresholds(run, { spreadMin: 8, returnMin: 11 })).toBe(false);
    expect(canApplyThresholds(run, { spreadMin: 7, returnMin: 20 })).toBe(false);
  });
});

describe("thresholdsEqual", () => {
  it("compares both fields", () => {
    expect(thresholdsEqual({ spreadMin: 1, returnMin: 2 }, { spreadMin: 1, returnMin: 2 })).toBe(
      true,
    );
    expect(thresholdsEqual({ spreadMin: 1, returnMin: 2 }, { spreadMin: 1, returnMin: 3 })).toBe(
      false,
    );
  });
});

describe("filterRowsByThresholds", () => {
  const rows = [
    { id: "a", spreadPct: 10, annualizedReturnPct: 20 },
    { id: "b", spreadPct: 8, annualizedReturnPct: 12 },
    { id: "c", spreadPct: 15, annualizedReturnPct: null },
    { id: "d", spreadPct: 9, annualizedReturnPct: 11 },
  ];

  it("keeps rows meeting both mins", () => {
    expect(filterRowsByThresholds(rows, { spreadMin: 8, returnMin: 12 }).map((row) => row.id)).toEqual(
      ["a", "b"],
    );
  });

  it("tightening drops borderline rows", () => {
    expect(filterRowsByThresholds(rows, { spreadMin: 9, returnMin: 12 }).map((row) => row.id)).toEqual(
      ["a"],
    );
  });
});
