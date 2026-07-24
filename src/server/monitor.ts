import { ACCOUNT_DEFINITIONS, type AccountId } from "@/config/accounts";
import { buildExpiryGroups } from "@/domain/pairing";
import { normalizePositions } from "@/domain/positions";
import type { AccountPositionSummary, MonitorSnapshot } from "@/domain/types";
import type { TradeSessionCredentials } from "./kotak/auth";
import { fetchPositions } from "./kotak/positions";
import { fetchSpotQuotes } from "./kotak/quotes";
import {
  loadScripMasterRegistry,
  resolveCashInstrument,
} from "./kotak/scrip-master";
import { handleBrokerAuthFailure } from "./session";
import { logInfo, logWarn } from "./logging";

let inFlight: Promise<MonitorSnapshot> | null = null;
let inFlightSessionKey: string | null = null;

function reportDateIst(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date())
    .replace(/ /g, "-");
}

function sessionKey(sessions: Record<AccountId, TradeSessionCredentials>): string {
  return ACCOUNT_DEFINITIONS.map(
    (definition) =>
      `${definition.id}:${sessions[definition.id].tradingSid}:${sessions[definition.id].tradingToken.slice(0, 8)}`,
  ).join("|");
}

async function buildSnapshot(
  sessions: Record<AccountId, TradeSessionCredentials>,
  requestId: string,
  sessionId: string | undefined,
): Promise<MonitorSnapshot> {
  logInfo("Reading positions...", {
    requestId,
    runtimeRegion: process.env.VERCEL_REGION ?? "local",
    accounts: ACCOUNT_DEFINITIONS.map((definition) => definition.id),
  });

  const firstSession = sessions[ACCOUNT_DEFINITIONS[0].id];
  const registry = await loadScripMasterRegistry(firstSession);

  const accountResults = await Promise.all(
    ACCOUNT_DEFINITIONS.map(async (definition) => {
      try {
        const rawPositions = await fetchPositions(
          sessions[definition.id],
          requestId,
          definition.id,
        );
        const positions = normalizePositions(rawPositions, registry, {
          accountId: definition.id,
          accountLabel: definition.label,
        });
        return {
          accountId: definition.id,
          accountLabel: definition.label,
          positions,
        };
      } catch (error) {
        await handleBrokerAuthFailure(sessionId, definition.id, error);
        throw error;
      }
    }),
  );

  const positions = accountResults.flatMap((result) => result.positions);
  const accountSummaries: AccountPositionSummary[] = accountResults.map((result) => ({
    accountId: result.accountId,
    accountLabel: result.accountLabel,
    optionPositionCount: result.positions.length,
  }));

  logInfo(`Found ${positions.length} option positions across accounts`);

  const companies = [...new Set(positions.map((position) => position.company))];
  const instruments: {
    company: string;
    instrumentToken: string;
    exchangeSegment: string;
  }[] = [];
  const spotByCompany = new Map<string, number | null>();
  const missingSymbols: string[] = [];

  for (const company of companies) {
    const cash = resolveCashInstrument(registry, company);
    if (!cash) {
      spotByCompany.set(company, null);
      missingSymbols.push(company);
      continue;
    }
    instruments.push({
      company,
      instrumentToken: cash.instrumentToken,
      exchangeSegment: cash.exchangeSegment,
    });
  }

  logInfo("Downloading prices...");
  const quotes = await fetchSpotQuotes(
    firstSession,
    instruments.map((item) => ({
      instrumentToken: item.instrumentToken,
      exchangeSegment: item.exchangeSegment,
    })),
  );

  const quoteByToken = new Map(
    quotes.map((quote) => [`${quote.exchangeSegment}:${quote.instrumentToken}`, quote]),
  );

  for (const instrument of instruments) {
    const quote = quoteByToken.get(
      `${instrument.exchangeSegment}:${instrument.instrumentToken}`,
    );
    const spot = quote?.spot ?? null;
    if (spot === null || spot <= 0) {
      spotByCompany.set(instrument.company, null);
      missingSymbols.push(instrument.company);
      continue;
    }
    spotByCompany.set(instrument.company, spot);
  }

  const uniqueMissing = [...new Set(missingSymbols)].sort();
  const downloadedPriceCount = companies.length - uniqueMissing.length;

  logInfo(`Downloaded ${downloadedPriceCount} prices`);
  if (uniqueMissing.length > 0) {
    logWarn("Could not download prices for", { symbols: uniqueMissing });
  }

  const groups = buildExpiryGroups(positions, spotByCompany);
  const nameByUnderlying: Record<string, string> = {};
  for (const company of companies) {
    const name = registry.nameByUnderlying.get(company);
    if (name) {
      nameByUnderlying[company] = name;
    }
  }

  return {
    reportDate: reportDateIst(),
    generatedAt: new Date().toISOString(),
    optionPositionCount: positions.length,
    downloadedPriceCount,
    missingSymbols: uniqueMissing,
    accountSummaries,
    groups,
    nameByUnderlying,
  };
}

export async function getMonitorSnapshot(
  sessions: Record<AccountId, TradeSessionCredentials>,
  requestId: string,
  sessionId?: string,
): Promise<MonitorSnapshot> {
  const key = sessionKey(sessions);
  if (inFlight && inFlightSessionKey === key) {
    return inFlight;
  }

  inFlightSessionKey = key;
  inFlight = (async () => {
    try {
      return await buildSnapshot(sessions, requestId, sessionId);
    } finally {
      inFlight = null;
      inFlightSessionKey = null;
    }
  })();

  return inFlight;
}
