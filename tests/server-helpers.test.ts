import { describe, expect, it } from "vitest";
import { assertApprovedBaseUrl } from "@/server/kotak/client";
import { detectBrokerFailure } from "@/server/kotak/broker-response";
import {
  buildScripMasterRegistryFromInstruments,
  parseScripCsv,
  resolveCashInstrument,
} from "@/server/kotak/scrip-master";
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
    expect(cm.find((item) => item.underlying === "SBIN")?.exchangeSegment).toBe("nse_cm");
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
