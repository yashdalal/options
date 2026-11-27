import { describe, expect, it } from "vitest";
import { aelCsvUrl, parseAelCsv } from "@/server/span/elm";
import { exposureRate } from "@/server/span/exposure";

const AEL_CSV = [
  "Sr No.,Symbol,Instrument Type,Normal ELM Margin%,Additional ELM% for Trade Date 25-Nov-2026,Total applicable ELM%",
  "189,IDFCFIRSTB,OTH,3.5,15,18.5",
  "190,IDFCFIRSTB,OTM,5.25,15,20.25",
  "246,M&M,OTH,3.5,0,3.5",
  "247,M&M,OTM,5.25,0,5.25",
  "",
].join("\r\n");

describe("NSE AEL file", () => {
  it("builds the archive URL with a DDMMYYYY date", () => {
    expect(aelCsvUrl("20261125")).toBe(
      "https://nsearchives.nseindia.com/archives/exp_lim/ael_25112026.csv",
    );
  });

  it("parses total ELM per symbol for normal and deep out-of-money contracts", () => {
    const rates = parseAelCsv(AEL_CSV);
    expect(rates.get("IDFCFIRSTB")).toEqual({
      normalPercent: 18.5,
      deepOutOfMoneyPercent: 20.25,
    });
    expect(rates.get("M&M")).toEqual({
      normalPercent: 3.5,
      deepOutOfMoneyPercent: 5.25,
    });
  });

  it("ignores pages that are not an AEL file", () => {
    expect(parseAelCsv("<html>Not found</html>").size).toBe(0);
  });
});

describe("exposureRate", () => {
  const stock = { symbol: "IDFCFIRSTB", spot: 100 };
  const idfcRates = { normalPercent: 18.5, deepOutOfMoneyPercent: 20.25 };

  it("uses the stock's NSE rate, including additional ELM", () => {
    expect(
      exposureRate(
        { ...stock, elm: idfcRates },
        { instrumentType: "OPT", optionType: "P", strike: 90 },
      ),
    ).toBeCloseTo(0.185, 10);
  });

  it("uses the deep out-of-money rate beyond 30% for stocks", () => {
    const underlying = { ...stock, elm: idfcRates };
    expect(
      exposureRate(underlying, {
        instrumentType: "OPT",
        optionType: "P",
        strike: 69,
      }),
    ).toBeCloseTo(0.2025, 10);
    expect(
      exposureRate(underlying, {
        instrumentType: "OPT",
        optionType: "C",
        strike: 131,
      }),
    ).toBeCloseTo(0.2025, 10);
    expect(
      exposureRate(underlying, {
        instrumentType: "OPT",
        optionType: "C",
        strike: 129,
      }),
    ).toBeCloseTo(0.185, 10);
  });

  it("falls back to 3.5% and 5.25% when a stock has no NSE rate", () => {
    expect(
      exposureRate(stock, { instrumentType: "OPT", optionType: "C", strike: 105 }),
    ).toBeCloseTo(0.035, 10);
    expect(
      exposureRate(stock, { instrumentType: "OPT", optionType: "P", strike: 60 }),
    ).toBeCloseTo(0.0525, 10);
  });

  it("charges indexes 2%, or 3% beyond 10% out of the money", () => {
    const nifty = { symbol: "NIFTY", spot: 26000 };
    expect(
      exposureRate(nifty, { instrumentType: "OPT", optionType: "P", strike: 24000 }),
    ).toBeCloseTo(0.02, 10);
    expect(
      exposureRate(nifty, { instrumentType: "OPT", optionType: "P", strike: 23000 }),
    ).toBeCloseTo(0.03, 10);
  });

  it("never treats futures as deep out of the money", () => {
    expect(
      exposureRate({ ...stock, elm: idfcRates }, { instrumentType: "FUT" }),
    ).toBeCloseTo(0.185, 10);
  });
});
