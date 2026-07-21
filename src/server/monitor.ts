import { buildExpiryGroups } from "@/domain/pairing";
import { normalizePositions } from "@/domain/positions";
import type { MonitorSnapshot } from "@/domain/types";
import type { TradeSessionCredentials } from "./kotak/auth";
import { fetchPositions } from "./kotak/positions";
import { fetchClosingQuotes } from "./kotak/quotes";
import {
  loadScripMasterRegistry,
  resolveCashInstrument,
} from "./kotak/scrip-master";
import { handleBrokerAuthFailure } from "./session";
import { logInfo, logWarn } from "./logging";

let inFlight: Promise<MonitorSnapshot> | null = null;

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

async function buildSnapshot(
  session: TradeSessionCredentials,
  requestId: string,
): Promise<MonitorSnapshot> {
  logInfo("Reading positions...", {
    requestId,
    runtimeRegion: process.env.VERCEL_REGION ?? "local",
  });
  const rawPositions = await fetchPositions(session, requestId);
  const registry = await loadScripMasterRegistry(session);
  const positions = normalizePositions(rawPositions, registry);
  logInfo(`Found ${positions.length} option positions`);

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
  const quotes = await fetchClosingQuotes(
    session,
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
    const close = quote?.previousClose ?? null;
    if (close === null || close <= 0) {
      spotByCompany.set(instrument.company, null);
      missingSymbols.push(instrument.company);
      continue;
    }
    spotByCompany.set(instrument.company, close);
  }

  const uniqueMissing = [...new Set(missingSymbols)].sort();
  const downloadedPriceCount = companies.length - uniqueMissing.length;

  logInfo(`Downloaded ${downloadedPriceCount} prices`);
  if (uniqueMissing.length > 0) {
    logWarn("Could not download prices for", { symbols: uniqueMissing });
  }

  const groups = buildExpiryGroups(positions, spotByCompany);

  return {
    reportDate: reportDateIst(),
    generatedAt: new Date().toISOString(),
    optionPositionCount: positions.length,
    downloadedPriceCount,
    missingSymbols: uniqueMissing,
    groups,
  };
}

export async function getMonitorSnapshot(
  session: TradeSessionCredentials,
  requestId: string,
): Promise<MonitorSnapshot> {
  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      return await buildSnapshot(session, requestId);
    } catch (error) {
      handleBrokerAuthFailure(error);
      throw error;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
