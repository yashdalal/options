import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT_DEFINITIONS, isAccountId, type AccountId } from "../src/config/accounts";
import { getAccountCredentials } from "../src/config/env";
import type { ScreenSideFilter } from "../src/domain/types";
import { normalizePositions } from "../src/domain/positions";
import { loginWithTotp, logoutSession } from "../src/server/kotak/auth";
import { checkMargin } from "../src/server/kotak/margin";
import { fetchPositions } from "../src/server/kotak/positions";
import { fetchQuotes, fetchSpotQuotes } from "../src/server/kotak/quotes";
import {
  listOptionsForUnderlyingExpiry,
  listOptionUnderlyings,
  loadScripMasterRegistry,
  resolveCashInstrument,
} from "../src/server/kotak/scrip-master";
import { redactValue } from "../src/server/logging";
import { getScreenMargins, getScreenSnapshot } from "../src/server/screen";

config({ path: ".env.local" });
config();

async function readTotp(): Promise<string> {
  const fromArg = process.argv.find((arg) => arg.startsWith("--totp="));
  if (fromArg) {
    return fromArg.slice("--totp=".length);
  }
  if (process.env.KOTAK_TOTP) {
    return process.env.KOTAK_TOTP;
  }

  process.stdout.write("Enter current TOTP: ");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
    if (chunk.toString().includes("\n")) {
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function readAccountId(): AccountId {
  const fromArg = process.argv.find((arg) => arg.startsWith("--account="));
  const value = fromArg?.slice("--account=".length) ?? "prakash";
  if (!isAccountId(value)) {
    throw new Error(
      `Unknown account '${value}'. Use one of: ${ACCOUNT_DEFINITIONS.map((item) => item.id).join(", ")}`,
    );
  }
  return value;
}

function readFlag(name: string): string | undefined {
  const fromArg = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return fromArg?.slice(`--${name}=`.length);
}

function readNumberFlag(name: string, fallback: number): number {
  const raw = readFlag(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a number`);
  }
  return parsed;
}

function readSideFlag(): ScreenSideFilter {
  const raw = (readFlag("side") ?? "BOTH").toUpperCase();
  if (raw === "CALL" || raw === "PUT" || raw === "BOTH") {
    return raw;
  }
  throw new Error("--side must be CALL, PUT, or BOTH");
}

function summarizeKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).sort();
}

async function writeProbeJson(fileName: string, value: unknown): Promise<string> {
  const outDir = path.join(process.cwd(), ".cache", "probe");
  await mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, fileName);
  await writeFile(filePath, JSON.stringify(redactValue(value), null, 2), "utf8");
  return filePath;
}

type ScreenerScenario = {
  symbol: string;
  expiryIso: string;
  side: ScreenSideFilter;
  spreadMin: number;
  returnMin: number;
  lots: number;
};

function readScreenerScenario(): ScreenerScenario | null {
  const symbolFlag = readFlag("symbol");
  if (symbolFlag === undefined) {
    return null;
  }
  const symbol = symbolFlag.trim().toUpperCase();
  const expiryIso = (readFlag("expiry") ?? "").trim();
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(expiryIso)) {
    throw new Error("Screener probe requires --symbol=TICKER and --expiry=YYYY-MM-DD");
  }
  return {
    symbol,
    expiryIso,
    side: readSideFlag(),
    spreadMin: readNumberFlag("spread", 1),
    returnMin: readNumberFlag("return", 1),
    lots: Math.max(1, Math.floor(readNumberFlag("lots", 2))),
  };
}

async function runScreenerScenario(
  accountId: AccountId,
  session: Awaited<ReturnType<typeof loginWithTotp>>,
  scenario: ScreenerScenario,
): Promise<void> {
  const { symbol, expiryIso, side, spreadMin, returnMin, lots } = scenario;
  const requestId = `probe-screen-${Date.now()}`;
  const sessions = {
    prakash: session,
    gopa: session,
    huf: session,
  } as Record<AccountId, typeof session>;
  sessions[accountId] = session;

  console.log(
    `Screening ${symbol} ${side} expiry=${expiryIso} spreadMin=${spreadMin} returnMin=${returnMin} lots=${lots}...`,
  );

  let snapshot: Awaited<ReturnType<typeof getScreenSnapshot>> | null = null;
  let snapshotError: string | null = null;
  try {
    snapshot = await getScreenSnapshot(
      sessions,
      {
        symbol,
        expiryIso,
        spreadMin,
        returnMin,
        side,
        lots,
      },
      requestId,
    );
  } catch (error) {
    snapshotError = error instanceof Error ? error.message : String(error);
    console.error("getScreenSnapshot failed:", snapshotError);
  }

  const snapshotPath = await writeProbeJson("screen-snapshot.json", {
    requestId,
    symbol,
    expiryIso,
    side,
    spreadMin,
    returnMin,
    lots,
    snapshotError,
    snapshot,
  });
  console.log("Wrote", snapshotPath);

  if (!snapshot) {
    return;
  }

  const marginItems = snapshot.candidates
    .filter((row) => row.hasBid && row.premium !== null && row.premium > 0)
    .slice(0, 40)
    .map((row) => ({
      id: row.id,
      instrumentToken: row.instrumentToken,
      exchangeSegment: row.exchangeSegment,
      tradingSymbol: row.tradingSymbol,
      premium: row.premium as number,
      quantity: row.lotSize * row.lots,
      underlying: row.company,
      expiryIso: row.expiryIso,
      strike: row.strike,
      optionType: row.optionType,
      lots: row.lots,
      lotSize: row.lotSize,
    }));

  let margins: Awaited<ReturnType<typeof getScreenMargins>> | null = null;
  let marginsError: string | null = null;
  if (marginItems.length > 0) {
    try {
      margins = await getScreenMargins(
        sessions,
        marginItems,
        accountId,
        `${requestId}-margins`,
      );
    } catch (error) {
      marginsError = error instanceof Error ? error.message : String(error);
      console.error("getScreenMargins failed:", marginsError);
    }
  }

  const marginsPath = await writeProbeJson("screen-margins.json", {
    requestId,
    symbol,
    itemCount: marginItems.length,
    marginsError,
    margins,
  });
  console.log("Wrote", marginsPath);
}

async function main(): Promise<void> {
  const accountId = readAccountId();
  const scenario = readScreenerScenario();
  if (scenario) {
    console.log("Screener scenario:", scenario);
  }
  const account = getAccountCredentials(accountId);
  const totp = await readTotp();
  if (!/^\d{6}$/.test(totp)) {
    throw new Error("TOTP must be a 6-digit code");
  }

  console.log(`Authenticating ${account.label}...`);
  const session = await loginWithTotp(account, totp);
  console.log("Trade session established. baseUrl host:", new URL(session.baseUrl).host);

  if (scenario) {
    try {
      await runScreenerScenario(accountId, session, scenario);
    } finally {
      await logoutSession(session);
    }
    console.log("Screener probe complete.");
    return;
  }

  console.log("Fetching positions...");
  const positions = await fetchPositions(session);
  console.log(`Raw position rows: ${positions.length}`);
  if (positions[0]) {
    console.log("Sample position keys:", summarizeKeys(positions[0]));
  }

  console.log("Loading scrip master...");
  const registry = await loadScripMasterRegistry(session);
  console.log(`Scrip registry tokens: ${registry.byToken.size}`);
  console.log(`Option underlyings: ${listOptionUnderlyings(registry).length}`);

  const normalized = normalizePositions(positions, registry, {
    accountId: account.id,
    accountLabel: account.label,
  });
  console.log(`Open NSE option positions: ${normalized.length}`);

  const companies = [...new Set(normalized.map((item) => item.company))];
  const instruments = companies
    .map((company) => {
      const cash = resolveCashInstrument(registry, company);
      return cash
        ? {
            instrumentToken: cash.instrumentToken,
            exchangeSegment: cash.exchangeSegment,
            company,
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  console.log("Fetching spot quotes...");
  const quotes = await fetchSpotQuotes(
    session,
    instruments.map(({ instrumentToken, exchangeSegment }) => ({
      instrumentToken,
      exchangeSegment,
    })),
  );
  console.log(`Quote rows: ${quotes.length}`);
  if (quotes[0]) {
    console.log("Sample quote:", redactValue(quotes[0]));
  }

  let foQuoteSample: unknown = null;
  let marginSample: unknown = null;
  const sampleUnderlying = listOptionUnderlyings(registry)[0];
  if (sampleUnderlying) {
    const firstExpiry =
      registry.optionsByUnderlying.get(sampleUnderlying)?.[0]?.expiryIso ?? "";
    const sampleOptions = listOptionsForUnderlyingExpiry(
      registry,
      sampleUnderlying,
      firstExpiry,
    ).filter((option) => option.optionType && option.strike !== null);
    const sampleOption = sampleOptions[0];
    if (sampleOption) {
      console.log(
        `Fetching FO option quote for ${sampleOption.tradingSymbol} (${sampleOption.instrumentToken})...`,
      );
      const foQuotes = await fetchQuotes(session, [
        {
          instrumentToken: sampleOption.instrumentToken,
          exchangeSegment: sampleOption.exchangeSegment,
        },
      ]);
      foQuoteSample = foQuotes[0] ?? null;
      console.log("Sample FO quote:", redactValue(foQuoteSample));

      const premium = foQuotes[0]?.ltp;
      if (premium && premium > 0) {
        console.log("Checking sell margin for sample option...");
        try {
          const margin = await checkMargin(session, {
            instrumentToken: sampleOption.instrumentToken,
            exchangeSegment: sampleOption.exchangeSegment,
            tradingSymbol: sampleOption.tradingSymbol,
            price: premium,
            quantity: sampleOption.lotSize,
            transactionType: "S",
          });
          marginSample = {
            instrumentToken: margin.instrumentToken,
            totalMarginUsed: margin.totalMarginUsed,
          };
          console.log("Sample margin:", redactValue(marginSample));
        } catch (error) {
          console.log(
            "Margin probe failed:",
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
  }

  await writeProbeJson("sanitized-summary.json", {
    accountId: account.id,
    accountLabel: account.label,
    positionCount: positions.length,
    optionPositionCount: normalized.length,
    optionUnderlyingCount: listOptionUnderlyings(registry).length,
    companies,
    samplePositionKeys: positions[0] ? summarizeKeys(positions[0]) : [],
    quoteCount: quotes.length,
    quotesWithSpot: quotes.filter((quote) => quote.spot !== null).length,
    foQuoteSample,
    marginSample,
  });

  await logoutSession(session);
  console.log("Probe complete. Summary written to .cache/probe/sanitized-summary.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
