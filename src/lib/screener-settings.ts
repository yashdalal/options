import { ACCOUNT_DEFINITIONS, type AccountId } from "@/config/accounts";
import type { ScreenSideFilter } from "@/domain/types";

export const SCREENER_SETTINGS_KEY = "options_screener_settings";

export type ScreenerSettings = {
  spreadMin: number;
  returnMin: number;
  lots: number;
  side: ScreenSideFilter;
  accountId: AccountId;
};

export const DEFAULT_SCREENER_SETTINGS: ScreenerSettings = {
  spreadMin: 18,
  returnMin: 24,
  lots: 1,
  side: "BOTH",
  accountId: "prakash",
};

export function readScreenerSettings(): ScreenerSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SCREENER_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SCREENER_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SCREENER_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<ScreenerSettings>;
    return {
      spreadMin: Number(parsed.spreadMin) || DEFAULT_SCREENER_SETTINGS.spreadMin,
      returnMin: Number(parsed.returnMin) || DEFAULT_SCREENER_SETTINGS.returnMin,
      lots: Math.max(1, Math.floor(Number(parsed.lots) || 1)),
      side:
        parsed.side === "CALL" || parsed.side === "PUT" || parsed.side === "BOTH"
          ? parsed.side
          : "BOTH",
      accountId:
        parsed.accountId && ACCOUNT_DEFINITIONS.some((item) => item.id === parsed.accountId)
          ? parsed.accountId
          : "prakash",
    };
  } catch {
    return DEFAULT_SCREENER_SETTINGS;
  }
}

export function writeScreenerSettings(settings: ScreenerSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SCREENER_SETTINGS_KEY, JSON.stringify(settings));
}
