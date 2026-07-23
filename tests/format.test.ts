import { describe, expect, it } from "vitest";
import { formatNumber, formatPercent, formatRupees } from "@/lib/format";

describe("format helpers", () => {
  it("formats numbers with en-IN grouping", () => {
    expect(formatNumber(1234.5)).toBe("1,234.50");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
  });

  it("prefixes rupee amounts with ₹ and keeps missing values bare", () => {
    expect(formatRupees(31.5)).toBe("₹31.50");
    expect(formatRupees(10_000, 0)).toBe("₹10,000");
    expect(formatRupees(null)).toBe("—");
    expect(formatRupees(Number.NaN)).toBe("—");
  });

  it("formats percents with a % suffix", () => {
    expect(formatPercent(1.25)).toBe("1.25%");
    expect(formatPercent(null)).toBe("—");
  });
});
