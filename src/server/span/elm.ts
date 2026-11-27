import { logWarn } from "../logging";
import { normalizeSpanSymbol } from "./parse";
import type { ElmRates } from "./types";
import { NSE_USER_AGENT, previousCalendarDates } from "./urls";

const AEL_ARCHIVES_BASE = "https://nsearchives.nseindia.com/archives/exp_lim";

export type ElmRatesFile = {
  date: string;
  rates: Map<string, ElmRates>;
};

export function aelCsvUrl(dateYyyymmdd: string): string {
  const ddmmyyyy = `${dateYyyymmdd.slice(6, 8)}${dateYyyymmdd.slice(4, 6)}${dateYyyymmdd.slice(0, 4)}`;
  return `${AEL_ARCHIVES_BASE}/ael_${ddmmyyyy}.csv`;
}

export function parseAelCsv(csv: string): Map<string, ElmRates> {
  const partial = new Map<string, Partial<ElmRates>>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [, rawSymbol, instrumentType, , , rawTotal] = line.split(",");
    const totalPercent = Number(rawTotal);
    if (!rawSymbol || !Number.isFinite(totalPercent) || totalPercent <= 0) {
      continue;
    }
    const symbol = normalizeSpanSymbol(rawSymbol.trim());
    const rates = partial.get(symbol) ?? {};
    if (instrumentType?.trim() === "OTM") {
      rates.deepOutOfMoneyPercent = totalPercent;
    } else if (instrumentType?.trim() === "OTH") {
      rates.normalPercent = totalPercent;
    }
    partial.set(symbol, rates);
  }

  const complete = new Map<string, ElmRates>();
  for (const [symbol, rates] of partial) {
    if (rates.normalPercent !== undefined) {
      complete.set(symbol, {
        normalPercent: rates.normalPercent,
        deepOutOfMoneyPercent:
          rates.deepOutOfMoneyPercent ?? rates.normalPercent,
      });
    }
  }
  return complete;
}

export async function fetchLatestElmRates(
  fromYyyymmdd: string,
  lookbackDays = 7,
): Promise<ElmRatesFile | null> {
  for (const date of previousCalendarDates(fromYyyymmdd, lookbackDays)) {
    const url = aelCsvUrl(date);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": NSE_USER_AGENT },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        continue;
      }
      const rates = parseAelCsv(await response.text());
      if (rates.size > 0) {
        return { date, rates };
      }
    } catch (error) {
      logWarn("NSE ELM file fetch failed", {
        url,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return null;
}
