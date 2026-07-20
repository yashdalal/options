import { describe, expect, it } from "vitest";
import { assertApprovedBaseUrl } from "@/server/kotak/client";
import { parseScripCsv } from "@/server/kotak/scrip-master";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redactValue } from "@/server/logging";
import { shouldHighlightRow } from "@/domain/proximity";

describe("assertApprovedBaseUrl", () => {
  it("accepts https kotak hosts", () => {
    expect(assertApprovedBaseUrl("https://cis.kotaksecurities.com")).toBe(
      "https://cis.kotaksecurities.com",
    );
  });

  it("rejects non-https or unknown hosts", () => {
    expect(() => assertApprovedBaseUrl("http://cis.kotaksecurities.com")).toThrow();
    expect(() => assertApprovedBaseUrl("https://evil.example.com")).toThrow();
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

describe("threshold behavior", () => {
  it("does not highlight missing sides", () => {
    expect(shouldHighlightRow(undefined, undefined, 10)).toBe(false);
  });
});
