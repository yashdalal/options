import type { BoardMeetingInfo } from "@/domain/types";

function indiaTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type DemoMeetingSpec = {
  daysAhead?: number;
  daysAgo?: number;
  purpose: string;
  description: string;
};

const DEMO_MEETINGS: Record<string, DemoMeetingSpec> = {
  SBIN: {
    daysAhead: 18,
    daysAgo: 72,
    purpose: "Financial Results",
    description: "Demo board meeting for quarterly results",
  },
  BOSCHLTD: {
    daysAhead: 40,
    daysAgo: 55,
    purpose: "Board Meeting",
    description: "Demo corporate action calendar entry",
  },
  ASHOKLEY: {
    daysAgo: 48,
    purpose: "Financial Results",
    description: "Demo prior-quarter results meeting (next not announced)",
  },
  "M&M": {
    daysAgo: 90,
    purpose: "Financial Results",
    description: "Demo older-quarter meeting while next date is pending",
  },
};

export async function demoGetBoardMeetings(
  nseSymbol: string,
): Promise<BoardMeetingInfo> {
  const symbol = nseSymbol.trim().toUpperCase();
  const entry = DEMO_MEETINGS[symbol];
  if (!entry) {
    return { next: null, last: null };
  }
  const today = indiaTodayIso();
  const next =
    entry.daysAhead === undefined
      ? null
      : {
          dateIso: addDaysIso(today, entry.daysAhead),
          purpose: entry.purpose,
          description: entry.description,
        };
  const last =
    entry.daysAgo === undefined
      ? null
      : {
          dateIso: addDaysIso(today, -entry.daysAgo),
          purpose: entry.purpose,
          description: entry.description,
        };
  return { next, last };
}
