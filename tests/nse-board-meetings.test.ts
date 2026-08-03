import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  buildBoardMeetingsBySymbol,
  buildLastBoardMeetingBySymbol,
  buildNextBoardMeetingBySymbol,
  buildNseBoardMeetingFeedUrl,
  formatNseQueryDate,
  indiaTodayIso,
  normalizeCorporateBoardMeetingRows,
  parseNseEventDate,
} from "@/server/market-data/nse-board-meetings";

describe("parseNseEventDate", () => {
  it("parses NSE DD-Mon-YYYY dates to ISO", () => {
    expect(parseNseEventDate("24-Jul-2026")).toBe("2026-07-24");
    expect(parseNseEventDate("01-Aug-2026")).toBe("2026-08-01");
    expect(parseNseEventDate("9-Jan-2026")).toBe("2026-01-09");
  });

  it("rejects invalid dates", () => {
    expect(parseNseEventDate("")).toBeNull();
    expect(parseNseEventDate("2026-07-24")).toBeNull();
    expect(parseNseEventDate("32-Jul-2026")).toBeNull();
    expect(parseNseEventDate("24-Foo-2026")).toBeNull();
  });
});

describe("indiaTodayIso", () => {
  it("formats an instant in Asia/Kolkata as YYYY-MM-DD", () => {
    expect(indiaTodayIso(new Date("2026-07-22T20:00:00.000Z"))).toBe("2026-07-23");
  });
});

describe("formatNseQueryDate / addMonthsIso", () => {
  it("formats ISO dates for NSE query params", () => {
    expect(formatNseQueryDate("2026-07-23")).toBe("23-07-2026");
    expect(formatNseQueryDate("2026-08-01")).toBe("01-08-2026");
  });

  it("adds calendar months in UTC", () => {
    expect(addMonthsIso("2026-07-23", 3)).toBe("2026-10-23");
  });
});

describe("buildNseBoardMeetingFeedUrl", () => {
  it("includes lookback and lookahead so last and next meetings resolve", () => {
    expect(buildNseBoardMeetingFeedUrl("event-calendar", "2026-07-23")).toBe(
      "https://www.nseindia.com/api/event-calendar?index=equities&from_date=23-01-2026&to_date=23-10-2026",
    );
    expect(
      buildNseBoardMeetingFeedUrl("corporate-board-meetings", "2026-07-23"),
    ).toBe(
      "https://www.nseindia.com/api/corporate-board-meetings?index=equities&from_date=23-01-2026&to_date=23-10-2026",
    );
  });

  it("does not restrict to fo_sec so F&O underlyings NSE omits from that filter still resolve", () => {
    const eventUrl = buildNseBoardMeetingFeedUrl("event-calendar", "2026-07-23");
    const corporateUrl = buildNseBoardMeetingFeedUrl(
      "corporate-board-meetings",
      "2026-07-23",
    );
    expect(eventUrl).not.toContain("fo_sec");
    expect(corporateUrl).not.toContain("fo_sec");
  });
});

describe("buildNextBoardMeetingBySymbol", () => {
  it("keeps the earliest upcoming meeting per symbol", () => {
    const bySymbol = buildNextBoardMeetingBySymbol(
      [
        {
          symbol: "ITC",
          purpose: "Financial Results",
          description: "Q1 results",
          date: "31-Jul-2026",
        },
        {
          symbol: "itc",
          purpose: "Other business matters",
          description: "Earlier other matters",
          date: "28-Jul-2026",
        },
        {
          symbol: "PASTCO",
          purpose: "Financial Results",
          description: "Already held",
          date: "20-Jul-2026",
        },
      ],
      "2026-07-23",
    );

    expect(bySymbol.get("ITC")).toEqual({
      dateIso: "2026-07-28",
      purpose: "Other business matters",
      description: "Earlier other matters",
    });
    expect(bySymbol.has("PASTCO")).toBe(false);
  });

  it("prefers financial-results purpose on the same date", () => {
    const bySymbol = buildNextBoardMeetingBySymbol(
      [
        {
          symbol: "ASIANPAINT",
          purpose: "Board Meeting Intimation",
          description: "Intimation only",
          date: "29-Jul-2026",
        },
        {
          symbol: "ASIANPAINT",
          purpose: "Financial Results",
          description: "Approve quarterly results",
          date: "29-Jul-2026",
        },
      ],
      "2026-07-23",
    );

    expect(bySymbol.get("ASIANPAINT")).toEqual({
      dateIso: "2026-07-29",
      purpose: "Financial Results",
      description: "Approve quarterly results",
    });
  });

  it("normalizes corporate board-meeting rows", () => {
    const rows = normalizeCorporateBoardMeetingRows([
      {
        bm_symbol: "INFY",
        bm_date: "23-Jul-2026",
        bm_purpose: "Financial Results",
        bm_desc: "Q1 results",
      },
    ]);
    const bySymbol = buildNextBoardMeetingBySymbol(rows, "2026-07-23");
    expect(bySymbol.get("INFY")).toEqual({
      dateIso: "2026-07-23",
      purpose: "Financial Results",
      description: "Q1 results",
    });
  });
});

describe("buildLastBoardMeetingBySymbol", () => {
  it("keeps the most recent past meeting per symbol", () => {
    const bySymbol = buildLastBoardMeetingBySymbol(
      [
        {
          symbol: "ASHOKLEY",
          purpose: "Financial Results",
          description: "Older quarter",
          date: "15-Jan-2026",
        },
        {
          symbol: "ASHOKLEY",
          purpose: "Financial Results",
          description: "Prior quarter",
          date: "12-May-2026",
        },
        {
          symbol: "FUTURECO",
          purpose: "Financial Results",
          description: "Upcoming",
          date: "31-Jul-2026",
        },
      ],
      "2026-07-23",
    );

    expect(bySymbol.get("ASHOKLEY")).toEqual({
      dateIso: "2026-05-12",
      purpose: "Financial Results",
      description: "Prior quarter",
    });
    expect(bySymbol.has("FUTURECO")).toBe(false);
  });
});

describe("buildBoardMeetingsBySymbol", () => {
  it("returns next and last together so blank next still shows last", () => {
    const bySymbol = buildBoardMeetingsBySymbol(
      [
        {
          symbol: "ASHOKLEY",
          purpose: "Financial Results",
          description: "Prior quarter",
          date: "12-May-2026",
        },
        {
          symbol: "SBIN",
          purpose: "Financial Results",
          description: "Upcoming",
          date: "10-Aug-2026",
        },
        {
          symbol: "SBIN",
          purpose: "Financial Results",
          description: "Prior",
          date: "20-Apr-2026",
        },
      ],
      "2026-07-23",
    );

    expect(bySymbol.get("ASHOKLEY")).toEqual({
      next: null,
      last: {
        dateIso: "2026-05-12",
        purpose: "Financial Results",
        description: "Prior quarter",
      },
    });
    expect(bySymbol.get("SBIN")).toEqual({
      next: {
        dateIso: "2026-08-10",
        purpose: "Financial Results",
        description: "Upcoming",
      },
      last: {
        dateIso: "2026-04-20",
        purpose: "Financial Results",
        description: "Prior",
      },
    });
  });
});
