import { ACCOUNT_DEFINITIONS, type AccountId, isAccountId } from "@/config/accounts";
import {
  buildScreenCandidate,
  calendarDaysLeft,
  selectOtmOptionsNearSpread,
  type ScreenableOption,
} from "@/domain/screening";
import type { ScreenCandidate, ScreenMeta, ScreenSideFilter, ScreenSnapshot } from "@/domain/types";
import type { TradeSessionCredentials } from "./kotak/auth";
import { checkMargin } from "./kotak/margin";
import { fetchQuotes } from "./kotak/quotes";
import {
  listExpiriesForUnderlying,
  listOptionUnderlyings,
  listOptionsForUnderlyingExpiry,
  loadScripMasterRegistry,
  resolveCashInstrument,
} from "./kotak/scrip-master";
import { handleBrokerAuthFailure } from "./session";
import { logInfo } from "./logging";

export type ScreenQuery = {
  symbol: string;
  expiryIso: string;
  spreadMin: number;
  spreadMax: number;
  returnMin: number;
  side: ScreenSideFilter;
  lots: number;
  expenses: number;
};

export type MarginRequestItem = {
  instrumentToken: string;
  exchangeSegment?: string;
  tradingSymbol?: string;
  premium: number;
  quantity: number;
};

function firstSession(
  sessions: Record<AccountId, TradeSessionCredentials>,
): TradeSessionCredentials {
  return sessions[ACCOUNT_DEFINITIONS[0].id];
}

function resolveAccountSession(
  sessions: Record<AccountId, TradeSessionCredentials>,
  accountId: string | undefined,
): { accountId: AccountId; session: TradeSessionCredentials } {
  const id = accountId && isAccountId(accountId) ? accountId : ACCOUNT_DEFINITIONS[0].id;
  return { accountId: id, session: sessions[id] };
}

export async function getScreenMeta(
  sessions: Record<AccountId, TradeSessionCredentials>,
): Promise<ScreenMeta> {
  const registry = await loadScripMasterRegistry(firstSession(sessions));
  const underlyings = listOptionUnderlyings(registry);
  const expiriesByUnderlying: Record<string, string[]> = {};
  for (const underlying of underlyings) {
    expiriesByUnderlying[underlying] = listExpiriesForUnderlying(registry, underlying);
  }
  return { underlyings, expiriesByUnderlying };
}

function toScreenable(options: ReturnType<typeof listOptionsForUnderlyingExpiry>): ScreenableOption[] {
  return options
    .filter(
      (option): option is typeof option & {
        optionType: "CALL" | "PUT";
        strike: number;
        expiryIso: string;
      } =>
        option.optionType !== null &&
        option.strike !== null &&
        option.expiryIso !== null,
    )
    .map((option) => ({
      optionType: option.optionType,
      strike: option.strike,
      lotSize: option.lotSize,
      instrumentToken: option.instrumentToken,
      exchangeSegment: option.exchangeSegment,
      tradingSymbol: option.tradingSymbol,
      expiryIso: option.expiryIso,
    }));
}

export async function getScreenSnapshot(
  sessions: Record<AccountId, TradeSessionCredentials>,
  query: ScreenQuery,
  requestId: string,
): Promise<ScreenSnapshot> {
  const session = firstSession(sessions);
  logInfo("Building screen snapshot", {
    requestId,
    symbol: query.symbol,
    expiryIso: query.expiryIso,
  });

  const registry = await loadScripMasterRegistry(session);
  const company = query.symbol.toUpperCase();
  const cash = resolveCashInstrument(registry, company);
  if (!cash) {
    return {
      generatedAt: new Date().toISOString(),
      company,
      expiryIso: query.expiryIso,
      spot: null,
      calendarDaysLeft: null,
      candidates: [],
    };
  }

  const options = toScreenable(
    listOptionsForUnderlyingExpiry(registry, company, query.expiryIso),
  );
  const daysLeft = calendarDaysLeft(query.expiryIso);

  let spot: number | null = null;
  try {
    const spotQuotes = await fetchQuotes(session, [
      {
        instrumentToken: cash.instrumentToken,
        exchangeSegment: cash.exchangeSegment,
      },
    ]);
    spot = spotQuotes[0]?.ltp ?? null;
  } catch (error) {
    handleBrokerAuthFailure(ACCOUNT_DEFINITIONS[0].id, error);
  }

  if (spot === null || !(spot > 0)) {
    return {
      generatedAt: new Date().toISOString(),
      company,
      expiryIso: query.expiryIso,
      spot: null,
      calendarDaysLeft: daysLeft,
      candidates: [],
    };
  }

  const selected = selectOtmOptionsNearSpread({
    options,
    spot,
    spreadMin: query.spreadMin,
    spreadMax: query.spreadMax,
    side: query.side,
  });

  const optionQuotes = selected.length
    ? await fetchQuotes(
        session,
        selected.map((option) => ({
          instrumentToken: option.instrumentToken,
          exchangeSegment: option.exchangeSegment,
        })),
      )
    : [];
  const premiumByToken = new Map(
    optionQuotes.map((quote) => [
      `${quote.exchangeSegment}:${quote.instrumentToken}`,
      quote.ltp,
    ]),
  );

  const candidates: ScreenCandidate[] = [];
  for (const option of selected) {
    const premium =
      premiumByToken.get(`${option.exchangeSegment}:${option.instrumentToken}`) ?? null;
    if (premium === null || !(premium > 0)) {
      continue;
    }
    const candidate = buildScreenCandidate({
      company,
      option,
      spot,
      premium,
      lots: query.lots,
      expenses: query.expenses,
      daysLeft,
      spreadMin: query.spreadMin,
      spreadMax: query.spreadMax,
      returnMin: query.returnMin,
    });
    if (candidate.meetsSpread) {
      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => {
    if (left.optionType !== right.optionType) {
      return left.optionType.localeCompare(right.optionType);
    }
    return left.strike - right.strike;
  });

  return {
    generatedAt: new Date().toISOString(),
    company,
    expiryIso: query.expiryIso,
    spot,
    calendarDaysLeft: daysLeft,
    candidates,
  };
}

export async function getScreenMargins(
  sessions: Record<AccountId, TradeSessionCredentials>,
  items: MarginRequestItem[],
  accountId: string | undefined,
  requestId: string,
): Promise<{ instrumentToken: string; margin: number | null; error?: string }[]> {
  const { accountId: resolvedAccountId, session } = resolveAccountSession(
    sessions,
    accountId,
  );
  logInfo("Checking screen margins", {
    requestId,
    accountId: resolvedAccountId,
    count: items.length,
  });

  const results: { instrumentToken: string; margin: number | null; error?: string }[] = [];
  for (const item of items) {
    try {
      const margin = await checkMargin(session, {
        instrumentToken: item.instrumentToken,
        exchangeSegment: item.exchangeSegment ?? "nse_fo",
        tradingSymbol: item.tradingSymbol,
        price: item.premium,
        quantity: item.quantity,
        transactionType: "S",
        product: "NRML",
        orderType: "L",
      });
      results.push({
        instrumentToken: item.instrumentToken,
        margin: margin.totalMarginUsed,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code: string }).code === "session_expired"
      ) {
        handleBrokerAuthFailure(resolvedAccountId, error);
      }
      results.push({
        instrumentToken: item.instrumentToken,
        margin: null,
        error: error instanceof Error ? error.message : "margin_failed",
      });
    }
  }
  return results;
}
