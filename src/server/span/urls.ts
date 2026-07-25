export const SPAN_ARCHIVES_BASE =
  "https://nsearchives.nseindia.com/archives/nsccl/span";

export const SPAN_VARIANTS = ["i5", "i4", "i3", "i2", "i1", "s"] as const;

export type SpanVariant = (typeof SPAN_VARIANTS)[number];

export const NSE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function formatSpanDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function istCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to resolve IST calendar date");
  }
  return `${year}${month}${day}`;
}

export function spanZipUrl(dateYyyymmdd: string, variant: SpanVariant): string {
  return `${SPAN_ARCHIVES_BASE}/nsccl.${dateYyyymmdd}.${variant}.zip`;
}

export function previousCalendarDates(
  fromYyyymmdd: string,
  count: number,
): string[] {
  const year = Number(fromYyyymmdd.slice(0, 4));
  const month = Number(fromYyyymmdd.slice(4, 6));
  const day = Number(fromYyyymmdd.slice(6, 8));
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) {
    dates.push(formatSpanDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}
