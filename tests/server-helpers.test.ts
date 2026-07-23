import { describe, expect, it } from "vitest";
import { assertApprovedBaseUrl } from "@/server/kotak/client";
import { detectBrokerFailure } from "@/server/kotak/broker-response";
import {
  buildScripMasterRegistryFromInstruments,
  clearScripMasterRegistryMemoryCache,
  filterExpiriesToCurrentAndNextMonth,
  listExpiriesForUnderlying,
  listOptionUnderlyings,
  listUnderlyingNames,
  loadScripMasterRegistry,
  parseScripCsv,
  resolveCashInstrument,
  seedScripMasterRegistryMemoryCache,
} from "@/server/kotak/scrip-master";
import type { TradeSessionCredentials } from "@/server/kotak/auth";
import {
  parseBuyDepth,
  resolveBestAsk,
  resolveBestBid,
  resolveYearHigh,
  resolveYearLow,
  toQuoteToken,
} from "@/server/kotak/quotes";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redactValue } from "@/server/logging";

describe("assertApprovedBaseUrl", () => {
  it("accepts https kotak hosts", () => {
    expect(assertApprovedBaseUrl("https://cis.kotaksecurities.com")).toBe(
      "https://cis.kotaksecurities.com",
    );
    expect(
      assertApprovedBaseUrl("https://e201.kotaksecurities.com/session-route/"),
    ).toBe("https://e201.kotaksecurities.com/session-route");
  });

  it("rejects non-https or unknown hosts", () => {
    expect(() => assertApprovedBaseUrl("http://cis.kotaksecurities.com")).toThrow();
    expect(() => assertApprovedBaseUrl("https://evil.example.com")).toThrow();
    expect(() =>
      assertApprovedBaseUrl("https://cis.kotaksecurities.com/path?token=unsafe"),
    ).toThrow();
  });
});

describe("broker response failures", () => {
  it("ignores empty error fields on otherwise successful payloads", () => {
    expect(
      detectBrokerFailure({
        stat: "Ok",
        data: { token: "abc", sid: "def" },
        emsg: "",
        errMsg: "",
      }),
    ).toBeNull();
  });

  it("detects Not_Ok responses with broker error messages", () => {
    expect(
      detectBrokerFailure({
        stCode: 200032,
        errMsg: "Invalid URL. Please verify the 'baseUrl' in the Login Validate API response",
        stat: "Not_Ok",
      }),
    ).toEqual({
      message: "Invalid URL. Please verify the 'baseUrl' in the Login Validate API response",
    });
  });
});

describe("empty positions payloads", () => {
  it("treats Kotak No Data responses as an empty book", async () => {
    const { isEmptyPositionsPayload } = await import("@/server/kotak/positions");
    expect(
      isEmptyPositionsPayload({
        desc: [],
        errMsg: "No Data",
        stCode: 5203,
        stat: "Not_Ok",
      }),
    ).toBe(true);
    expect(
      isEmptyPositionsPayload({
        data: [{ tok: "1" }],
        stCode: 200,
        stat: "ok",
      }),
    ).toBe(false);
  });
});

describe("scrip master memory cache", () => {
  it("returns the seeded registry without contacting the broker", async () => {
    const asOfDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const registry = buildScripMasterRegistryFromInstruments(asOfDate, [
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType
1,TEST-EQ,TEST,EQ`,
        "nse_cm",
      ),
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType
2,TESTB-EQ,TESTB,EQ`,
        "bse_cm",
      ),
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType,pOptionType,dStrikePrice,dExpiryDate
3,TEST31JUL25100CE,TEST,OPTSTK,CE,10000,31-Jul-2025`,
        "nse_fo",
      ),
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType,pOptionType,dStrikePrice,dExpiryDate
4,TESTB31JUL25100CE,TESTB,IO,CE,10000,31-Jul-2025`,
        "bse_fo",
      ),
    ]);
    clearScripMasterRegistryMemoryCache();
    seedScripMasterRegistryMemoryCache(registry);

    const session: TradeSessionCredentials = {
      accessToken: "unused",
      tradingToken: "unused",
      tradingSid: "unused",
      baseUrl: "https://cis.kotaksecurities.com",
      neoFinKey: "neotradeapi",
    };

    await expect(loadScripMasterRegistry(session)).resolves.toBe(registry);
    clearScripMasterRegistryMemoryCache();
  });
});

describe("cash instrument resolution", () => {
  it("prefers EQ cash symbols when BL rows appear later in scrip master", () => {
    const csv = `pSymbol,pTrdSymbol,pSymBl,pInstrumentType
19585,BSE-EQ,BSE,EQ
19588,BSE-BL,BSE,BL
10753,UNIONBANK-EQ,UNIONBANK,EQ
12856,UNIONBANK-BL,UNIONBANK,BL
26000,NIFTY,NIFTY,`;

    const registry = buildScripMasterRegistryFromInstruments(
      "2026-07-21",
      parseScripCsv(csv, "nse_cm"),
    );

    expect(resolveCashInstrument(registry, "BSE")?.tradingSymbol).toBe("BSE-EQ");
    expect(resolveCashInstrument(registry, "UNIONBANK")?.tradingSymbol).toBe("UNIONBANK-EQ");
    expect(resolveCashInstrument(registry, "NIFTY")?.tradingSymbol).toBe("NIFTY");
  });
});

describe("scrip csv parsing", () => {
  it("parses option and cash instruments", () => {
    const fo = parseScripCsv(
      readFileSync(path.join(process.cwd(), "tests/fixtures/kotak/nse_fo.csv"), "utf8"),
      "nse_fo",
    );
    const cm = parseScripCsv(
      readFileSync(path.join(process.cwd(), "tests/fixtures/kotak/nse_cm.csv"), "utf8"),
      "nse_cm",
    );
    expect(fo.find((item) => item.instrumentToken === "12345")?.optionType).toBe("CALL");
    expect(fo.find((item) => item.instrumentToken === "12345")?.strike).toBe(900);
    expect(fo.find((item) => item.instrumentToken === "12345")?.expiryIso).toBe("2025-07-31");
    expect(cm.find((item) => item.underlying === "SBIN")?.exchangeSegment).toBe("nse_cm");
    expect(cm.find((item) => item.underlying === "SBIN")?.name).toBe("STATE BANK OF INDIA");
  });

  it("indexes human-readable cash names for option underlyings", () => {
    const registry = buildScripMasterRegistryFromInstruments("2026-07-23", [
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType,pDesc
123,GRASIM-EQ,GRASIM,EQ,GRASIM INDUSTRIES LIMITED`,
        "nse_cm",
      ),
      ...parseScripCsv(
        `pSymbol,pGroup,pExchSeg,pInstType,pSymbolName,pTrdSymbol,pOptionType,dStrikePrice;,lLotSize,lExpiryDate ,lMultiplier
107305,XX,nse_fo,OPTSTK,GRASIM,GRASIM26AUG3740PE,PE,374000,250,1472135400,-1`,
        "nse_fo",
      ),
    ]);
    expect(listUnderlyingNames(registry)).toEqual({
      GRASIM: "GRASIM INDUSTRIES LIMITED",
    });
  });

  it("parses Kotak Neo FO headers with epoch expiry and paise strikes", () => {
    const csv = `pSymbol,pGroup,pExchSeg,pInstType,pSymbolName,pTrdSymbol,pOptionType,dStrikePrice;,lLotSize,lExpiryDate ,lMultiplier
107305,XX,nse_fo,OPTSTK,GRASIM,GRASIM26AUG3740PE,PE,374000,250,1472135400,-1
107309,XX,nse_fo,OPTSTK,GRASIM,GRASIM26AUG3820PE,PE,382000,250,1472135400,-1`;

    const fo = parseScripCsv(csv, "nse_fo");
    expect(fo).toHaveLength(2);
    expect(fo[0]?.underlying).toBe("GRASIM");
    expect(fo[0]?.strike).toBe(3740);
    expect(fo[0]?.expiryIso).toBe("2026-08-25");
    expect(fo[0]?.optionType).toBe("PUT");
    expect(fo[0]?.instrumentType).toBe("OPTSTK");

    const registry = buildScripMasterRegistryFromInstruments("2026-07-22", [
      ...fo,
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType
123,GRASIM-EQ,GRASIM,EQ`,
        "nse_cm",
      ),
    ]);
    expect(listOptionUnderlyings(registry)).toEqual(["GRASIM"]);
    expect(listExpiriesForUnderlying(registry, "GRASIM")).toEqual(["2026-08-25"]);
  });

  it("parses BSE IO options with Unix-epoch expiry timestamps", () => {
    const csv = `pSymbol,pGroup,pExchSeg,pInstType,pSymbolName,pTrdSymbol,pOptionType,dStrikePrice;,lLotSize,lExpiryDate ,lMultiplier
856820,XX,bse_fo,IO,SENSEX,SENSEX26JUL85300CE,CE,8530000,20,1785436199,1
856821,XX,bse_fo,IO,SENSEX,SENSEX26JUL85300PE,PE,8530000,20,1785436199,1`;

    const fo = parseScripCsv(csv, "bse_fo");
    expect(fo).toHaveLength(2);
    expect(fo[0]?.underlying).toBe("SENSEX");
    expect(fo[0]?.instrumentType).toBe("IO");
    expect(fo[0]?.expiryIso).toBe("2026-07-30");
    expect(fo[0]?.strike).toBe(85300);

    const registry = buildScripMasterRegistryFromInstruments("2026-07-23", [
      ...fo,
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType
1,SENSEX,SENSEX,`,
        "bse_cm",
      ),
    ]);
    expect(listOptionUnderlyings(registry)).toEqual(["SENSEX"]);
    expect(
      listExpiriesForUnderlying(registry, "SENSEX", new Date("2026-07-23T06:30:00Z")),
    ).toEqual(["2026-07-30"]);
  });

  it("limits Sensex expiries to the current and next IST month", () => {
    expect(
      filterExpiriesToCurrentAndNextMonth(
        ["2026-07-02", "2026-07-30", "2026-08-06", "2026-09-03", "2026-10-01"],
        new Date("2026-07-23T06:30:00Z"),
      ),
    ).toEqual(["2026-07-02", "2026-07-30", "2026-08-06"]);

    const csv = `pSymbol,pGroup,pExchSeg,pInstType,pSymbolName,pTrdSymbol,pOptionType,dStrikePrice;,lLotSize,lExpiryDate ,lMultiplier
856820,XX,bse_fo,IO,SENSEX,SENSEX30JUL85300CE,CE,8530000,20,30-Jul-2026,1
856821,XX,bse_fo,IO,SENSEX,SENSEX03SEP85300CE,CE,8530000,20,03-Sep-2026,1`;
    const fo = parseScripCsv(csv, "bse_fo");
    expect(fo.map((row) => row.expiryIso)).toEqual(["2026-07-30", "2026-09-03"]);
    const registry = buildScripMasterRegistryFromInstruments("2026-07-23", [
      ...fo,
      ...parseScripCsv(
        `pSymbol,pTrdSymbol,pSymBl,pInstrumentType
1,SENSEX,SENSEX,`,
        "bse_cm",
      ),
    ]);
    expect(
      listExpiriesForUnderlying(registry, "SENSEX", new Date("2026-07-23T06:30:00Z")),
    ).toEqual(["2026-07-30"]);
  });
});

describe("quote bid/ask resolution", () => {
  it("maps cash index tokens to Kotak quote names", () => {
    expect(toQuoteToken("26000")).toBe("Nifty 50");
    expect(toQuoteToken("1")).toBe("SENSEX");
    expect(toQuoteToken("26009")).toBe("Nifty Bank");
    expect(toQuoteToken("11536")).toBe("11536");
  });

  it("reads best bid/ask from depth and skips empty levels", () => {
    expect(
      resolveBestBid({
        depth: {
          buy: [
            { price: "0.0000", quantity: "0" },
            { price: "1.2500", quantity: "1500" },
          ],
          sell: [{ price: "1.4000", quantity: "800" }],
        },
      }),
    ).toBe(1.25);
    expect(
      resolveBestAsk({
        depth: {
          buy: [{ price: "1.2500", quantity: "1500" }],
          sell: [
            { price: "0", quantity: "0" },
            { price: "1.4000", quantity: "800" },
          ],
        },
      }),
    ).toBe(1.4);
    expect(
      resolveBestBid({
        depth: {
          buy: [{ price: "0", quantity: "0" }],
        },
        buy_price: "0.85",
      }),
    ).toBe(0.85);
    expect(resolveBestBid({ depth: { buy: [{ price: "0", quantity: "0" }] } })).toBeNull();
  });

  it("parses buy depth quantities used for lot allocation", () => {
    expect(
      parseBuyDepth([
        { price: "0", quantity: "0", orders: "0" },
        { price: "0.03", quantity: "7930500", orders: "35" },
        { price: "0.02", quantity: "19375300", orders: "51" },
      ]),
    ).toEqual([
      { price: 0.03, quantity: 7_930_500, orders: 35 },
      { price: 0.02, quantity: 19_375_300, orders: 51 },
    ]);
  });

  it("reads 52-week high and low from quote fields", () => {
    expect(
      resolveYearHigh({
        year_high: "2266",
        year_low: "345.5",
      }),
    ).toBe(2266);
    expect(
      resolveYearLow({
        year_high: "2266",
        year_low: "345.5",
      }),
    ).toBe(345.5);
    expect(
      resolveYearHigh({
        "52week_high": "920.00",
        "52week_low": "680.00",
      }),
    ).toBe(920);
    expect(
      resolveYearLow({
        "52week_high": "920.00",
        "52week_low": "680.00",
      }),
    ).toBe(680);
    expect(resolveYearHigh({ year_high: "0" })).toBeNull();
    expect(resolveYearLow({ year_low: "0.00" })).toBeNull();
    expect(resolveYearHigh({})).toBeNull();
    expect(resolveYearLow({})).toBeNull();
  });
});

describe("redaction", () => {
  it("redacts sensitive keys", () => {
    const redacted = redactValue({
      token: "secret",
      sid: "abc",
      nested: { mpin: "123456", ok: true },
    }) as Record<string, unknown>;
    expect(redacted.token).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).mpin).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).ok).toBe(true);
  });
});
