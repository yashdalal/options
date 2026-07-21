import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT_DEFINITIONS, isAccountId, type AccountId } from "../src/config/accounts";
import { getAccountCredentials } from "../src/config/env";
import { loginWithTotp, logoutSession } from "../src/server/kotak/auth";
import { fetchPositions } from "../src/server/kotak/positions";
import { fetchClosingQuotes } from "../src/server/kotak/quotes";
import {
  loadScripMasterRegistry,
  resolveCashInstrument,
} from "../src/server/kotak/scrip-master";
import { normalizePositions } from "../src/domain/positions";
import { redactValue } from "../src/server/logging";

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

function summarizeKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value).sort();
}

async function main(): Promise<void> {
  const accountId = readAccountId();
  const account = getAccountCredentials(accountId);
  const totp = await readTotp();
  if (!/^\d{6}$/.test(totp)) {
    throw new Error("TOTP must be a 6-digit code");
  }

  console.log(`Authenticating ${account.label}...`);
  const session = await loginWithTotp(account, totp);
  console.log("Trade session established. baseUrl host:", new URL(session.baseUrl).host);

  console.log("Fetching positions...");
  const positions = await fetchPositions(session);
  console.log(`Raw position rows: ${positions.length}`);
  if (positions[0]) {
    console.log("Sample position keys:", summarizeKeys(positions[0]));
  }

  console.log("Loading scrip master...");
  const registry = await loadScripMasterRegistry(session);
  console.log(`Scrip registry tokens: ${registry.byToken.size}`);

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

  console.log("Fetching closing quotes...");
  const quotes = await fetchClosingQuotes(
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

  const outDir = path.join(process.cwd(), ".cache", "probe");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "sanitized-summary.json"),
    JSON.stringify(
      redactValue({
        accountId: account.id,
        accountLabel: account.label,
        positionCount: positions.length,
        optionPositionCount: normalized.length,
        companies,
        samplePositionKeys: positions[0] ? summarizeKeys(positions[0]) : [],
        quoteCount: quotes.length,
        quotesWithClose: quotes.filter((quote) => quote.previousClose !== null).length,
      }),
      null,
      2,
    ),
    "utf8",
  );

  await logoutSession(session);
  console.log("Probe complete. Summary written to .cache/probe/sanitized-summary.json");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
