import { logWarn } from "../logging";

export type BoardMeeting = {
  dateIso: string;
  purpose: string;
  description: string;
};

export type NseBoardMeetingRow = {
  symbol?: string;
  purpose?: string;
  description?: string;
  date?: string;
};

type CacheEntry = {
  expiresAt: number;
  bySymbol: Map<string, BoardMeeting>;
};

type NseEventCalendarRow = {
  symbol?: string;
  purpose?: string;
  bm_desc?: string;
  date?: string;
};

type NseCorporateBoardMeetingRow = {
  bm_symbol?: string;
  bm_purpose?: string;
  bm_desc?: string;
  bm_date?: string;
};

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const LOOKAHEAD_MONTHS = 3;
const NSE_HOME = "https://www.nseindia.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

let calendarCache: CacheEntry | null = null;
let inFlight: Promise<Map<string, BoardMeeting>> | null = null;

export class NseBoardMeetingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NseBoardMeetingError";
  }
}

export function parseNseEventDate(value: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = MONTHS[match[2]];
  const year = Number(match[3]);
  if (
    !Number.isInteger(day) ||
    month === undefined ||
    !Number.isInteger(year) ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function indiaTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatNseQueryDate(isoDate: string): string {
  const [yearText, monthText, dayText] = isoDate.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) {
    throw new NseBoardMeetingError(`Invalid ISO date for NSE query: ${isoDate}`);
  }
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}

export function addMonthsIso(isoDate: string, months: number): string {
  const [yearText, monthText, dayText] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(yearText, monthText - 1, dayText));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function buildNseBoardMeetingFeedUrl(
  path: "event-calendar" | "corporate-board-meetings",
  todayIso: string,
): string {
  const toIso = addMonthsIso(todayIso, LOOKAHEAD_MONTHS);
  const url = new URL(`${NSE_HOME}/api/${path}`);
  url.searchParams.set("index", "equities");
  url.searchParams.set("from_date", formatNseQueryDate(todayIso));
  url.searchParams.set("to_date", formatNseQueryDate(toIso));
  return url.toString();
}

function purposeRank(purpose: string): number {
  const normalized = purpose.toLowerCase();
  if (normalized.includes("financial results")) {
    return 0;
  }
  if (normalized.includes("dividend")) {
    return 1;
  }
  if (normalized.includes("fund raising")) {
    return 2;
  }
  if (normalized === "board meeting intimation") {
    return 4;
  }
  return 3;
}

function isBetterMeeting(candidate: BoardMeeting, current: BoardMeeting): boolean {
  if (candidate.dateIso !== current.dateIso) {
    return candidate.dateIso < current.dateIso;
  }
  const purposeDelta = purposeRank(candidate.purpose) - purposeRank(current.purpose);
  if (purposeDelta !== 0) {
    return purposeDelta < 0;
  }
  return candidate.description.length > current.description.length;
}

export function normalizeEventCalendarRows(
  rows: NseEventCalendarRow[],
): NseBoardMeetingRow[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    purpose: row.purpose,
    description: row.bm_desc,
    date: row.date,
  }));
}

export function normalizeCorporateBoardMeetingRows(
  rows: NseCorporateBoardMeetingRow[],
): NseBoardMeetingRow[] {
  return rows.map((row) => ({
    symbol: row.bm_symbol,
    purpose: row.bm_purpose,
    description: row.bm_desc,
    date: row.bm_date,
  }));
}

export function buildNextBoardMeetingBySymbol(
  rows: NseBoardMeetingRow[],
  todayIso = indiaTodayIso(),
): Map<string, BoardMeeting> {
  const bySymbol = new Map<string, BoardMeeting>();
  for (const row of rows) {
    const symbol = row.symbol?.trim().toUpperCase();
    const dateIso = row.date ? parseNseEventDate(row.date) : null;
    if (!symbol || !dateIso || dateIso < todayIso) {
      continue;
    }
    const meeting: BoardMeeting = {
      dateIso,
      purpose: (row.purpose ?? "").trim() || "Board meeting",
      description: (row.description ?? "").trim(),
    };
    const existing = bySymbol.get(symbol);
    if (!existing || isBetterMeeting(meeting, existing)) {
      bySymbol.set(symbol, meeting);
    }
  }
  return bySymbol;
}

function collectCookies(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie
      .call(response.headers)
      .map((cookie) => cookie.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");
  }
  const single = response.headers.get("set-cookie");
  if (!single) {
    return "";
  }
  return single
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function warmNseSession(): Promise<string> {
  const warmUrls = [
    `${NSE_HOME}/companies-listing/corporate-filings-event-calendar`,
    NSE_HOME,
  ];
  const errors: string[] = [];

  for (const url of warmUrls) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      errors.push(`${url}: ${message}`);
      continue;
    }

    const cookies = collectCookies(response);
    if (cookies) {
      return cookies;
    }
    errors.push(`${url}: HTTP ${response.status} with no cookies`);
  }

  throw new NseBoardMeetingError(
    `NSE session warm-up failed: ${errors.join("; ") || "unknown"}`,
  );
}

async function fetchNseJson(
  url: string,
  cookies: string,
  referer: string,
  label: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: referer,
        Cookie: cookies,
      },
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new NseBoardMeetingError(`${label} request failed: ${message}`);
  }

  if (!response.ok) {
    throw new NseBoardMeetingError(`${label} request failed (HTTP ${response.status})`);
  }

  return response.json();
}

async function fetchEventCalendarRows(
  cookies: string,
  todayIso: string,
): Promise<NseBoardMeetingRow[]> {
  const payload = await fetchNseJson(
    buildNseBoardMeetingFeedUrl("event-calendar", todayIso),
    cookies,
    `${NSE_HOME}/companies-listing/corporate-filings-event-calendar`,
    "NSE event calendar",
  );
  if (!Array.isArray(payload)) {
    throw new NseBoardMeetingError("NSE event calendar returned unexpected payload");
  }
  return normalizeEventCalendarRows(payload as NseEventCalendarRow[]);
}

async function fetchCorporateBoardMeetingRows(
  cookies: string,
  todayIso: string,
): Promise<NseBoardMeetingRow[]> {
  const payload = await fetchNseJson(
    buildNseBoardMeetingFeedUrl("corporate-board-meetings", todayIso),
    cookies,
    `${NSE_HOME}/companies-listing/corporate-filings-board-meetings`,
    "NSE corporate board meetings",
  );

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message =
      "msg" in payload && typeof payload.msg === "string"
        ? payload.msg
        : "unexpected payload";
    if (/no data found/i.test(message)) {
      return [];
    }
    throw new NseBoardMeetingError(
      `NSE corporate board meetings returned unexpected payload: ${message}`,
    );
  }

  if (!Array.isArray(payload)) {
    throw new NseBoardMeetingError(
      "NSE corporate board meetings returned unexpected payload",
    );
  }

  return normalizeCorporateBoardMeetingRows(
    payload as NseCorporateBoardMeetingRow[],
  );
}

async function loadBoardMeetingCalendar(): Promise<Map<string, BoardMeeting>> {
  if (calendarCache && calendarCache.expiresAt > Date.now()) {
    return calendarCache.bySymbol;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    const todayIso = indiaTodayIso();
    const cookies = await warmNseSession();
    const [eventResult, corporateResult] = await Promise.allSettled([
      fetchEventCalendarRows(cookies, todayIso),
      fetchCorporateBoardMeetingRows(cookies, todayIso),
    ]);

    const rows: NseBoardMeetingRow[] = [];
    const errors: string[] = [];

    if (eventResult.status === "fulfilled") {
      rows.push(...eventResult.value);
    } else {
      const message =
        eventResult.reason instanceof Error
          ? eventResult.reason.message
          : "unknown";
      errors.push(message);
      logWarn("NSE event calendar fetch failed", { error: message });
    }

    if (corporateResult.status === "fulfilled") {
      rows.push(...corporateResult.value);
    } else {
      const message =
        corporateResult.reason instanceof Error
          ? corporateResult.reason.message
          : "unknown";
      errors.push(message);
      logWarn("NSE corporate board meetings fetch failed", { error: message });
    }

    if (rows.length === 0) {
      throw new NseBoardMeetingError(
        errors[0] ?? "NSE board meeting feeds returned no data",
      );
    }

    const bySymbol = buildNextBoardMeetingBySymbol(rows, todayIso);
    calendarCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      bySymbol,
    };
    return bySymbol;
  })();

  try {
    return await inFlight;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logWarn("NSE board meeting calendar fetch failed", { error: message });
    throw error instanceof NseBoardMeetingError
      ? error
      : new NseBoardMeetingError(message);
  } finally {
    inFlight = null;
  }
}

export async function getNextBoardMeeting(
  nseSymbol: string,
): Promise<BoardMeeting | null> {
  const symbol = nseSymbol.trim().toUpperCase();
  if (!symbol) {
    return null;
  }
  const bySymbol = await loadBoardMeetingCalendar();
  return bySymbol.get(symbol) ?? null;
}

export function clearNseBoardMeetingCache(): void {
  calendarCache = null;
  inFlight = null;
}
