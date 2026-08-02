import type { BoardMeeting } from "@/server/market-data/nse-board-meetings";

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

const DEMO_MEETINGS: Record<string, Omit<BoardMeeting, "dateIso"> & { daysAhead: number }> = {
  SBIN: {
    daysAhead: 18,
    purpose: "Financial Results",
    description: "Demo board meeting for quarterly results",
  },
  BOSCHLTD: {
    daysAhead: 40,
    purpose: "Board Meeting",
    description: "Demo corporate action calendar entry",
  },
};

export async function demoGetNextBoardMeeting(
  nseSymbol: string,
): Promise<BoardMeeting | null> {
  const symbol = nseSymbol.trim().toUpperCase();
  const entry = DEMO_MEETINGS[symbol];
  if (!entry) {
    return null;
  }
  return {
    dateIso: addDaysIso(indiaTodayIso(), entry.daysAhead),
    purpose: entry.purpose,
    description: entry.description,
  };
}
