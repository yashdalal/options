const IST = "Asia/Kolkata";

function yearMonthKeyIst(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
  }).format(date);
  return formatted.slice(0, 7);
}

function nextYearMonthKey(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Inclusive IST months: current month through `monthsAhead` months later. */
export function yearMonthKeysThrough(
  monthsAhead: number,
  now: Date = new Date(),
): Set<string> {
  const keys = new Set<string>();
  let cursor = yearMonthKeyIst(now);
  keys.add(cursor);
  for (let step = 0; step < monthsAhead; step += 1) {
    cursor = nextYearMonthKey(cursor);
    keys.add(cursor);
  }
  return keys;
}

/**
 * Keep expiries whose YYYY-MM falls in the current IST month through
 * `monthsAhead` months later (e.g. 2 in July → July, August, September).
 */
export function filterExpiriesWithinMonthsAhead(
  expiries: string[],
  monthsAhead: number,
  now: Date = new Date(),
): string[] {
  const allowed = yearMonthKeysThrough(monthsAhead, now);
  return expiries.filter((expiryIso) => allowed.has(expiryIso.slice(0, 7)));
}
