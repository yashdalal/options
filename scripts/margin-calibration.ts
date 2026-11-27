import { config } from "dotenv";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ScreenCandidate, ScreenMeta, ScreenSnapshot } from "../src/domain/types";
import { computePortfolioMargin } from "../src/server/span/engine";
import { basketLegsToSpanPositions } from "../src/server/span/positions";
import { readSpanUnderlyings } from "../src/server/span/store";
import type { MarginBreakdown } from "../src/server/span/types";

config({ path: ".env.local" });
config();

const CACHE_DIR = path.join(process.cwd(), ".cache", "margin-calibration");
const MARGIN_CHUNK_SIZE = 5;

type Sample = {
  at: string;
  account: string;
  underlying: string;
  exchangeSegment: string;
  expiryIso: string;
  optionType: "CALL" | "PUT";
  strike: number;
  spot: number;
  premium: number;
  lotSize: number;
  lots: number;
  kotakMargin: number;
  siteSpanTotal: number | null;
  span: MarginBreakdown;
  spanFile: string;
};

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function site<T>(base: string, cookie: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { ...init?.headers, cookie, "content-type": "application/json" },
  });
  if (response.status === 401) {
    throw new Error("Live site says login required: the session cookie is missing or expired.");
  }
  if (!response.ok) {
    throw new Error(`${pathname} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function collect(): Promise<void> {
  const base = arg("base", "https://options-zeta.vercel.app");
  const session = process.env.OPTIONS_SESSION?.trim();
  if (!session) {
    throw new Error("Set OPTIONS_SESSION to the near_expiry_session cookie value from the live site.");
  }
  const cookie = `${process.env.SESSION_COOKIE_NAME?.trim() || "near_expiry_session"}=${session}`;
  const symbols = arg("symbols", "NIFTY").split(",").map((symbol) => symbol.trim().toUpperCase());
  const side = arg("side", "BOTH");
  const account = arg("account", "prakash");
  const lots = arg("lots", "1");

  const meta = await site<ScreenMeta>(base, cookie, "/api/screen/meta");
  const loaded = await readSpanUnderlyings(symbols);
  if (!loaded) {
    throw new Error("No SPAN snapshot in Redis; click Refresh file in the basket on the live site first.");
  }
  const spanFile = `${loaded.meta.date}-${loaded.meta.variant}`;
  await mkdir(CACHE_DIR, { recursive: true });
  const outFile = path.join(CACHE_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

  for (const symbol of symbols) {
    const expiryIso = meta.expiriesByUnderlying[symbol]?.[0];
    if (!expiryIso) {
      console.log(`${symbol}: no expiry on the live site, skipped`);
      continue;
    }
    const query = new URLSearchParams({ symbol, expiry: expiryIso, spreadMin: "0", returnMin: "0", side, lots });
    const snapshot = await site<ScreenSnapshot>(base, cookie, `/api/screen?${query}`);
    const priced = snapshot.candidates.filter(
      (row): row is ScreenCandidate & { premium: number } => row.hasBid && row.premium !== null,
    );

    const samples: Sample[] = [];
    for (let index = 0; index < priced.length; index += MARGIN_CHUNK_SIZE) {
      const chunk = priced.slice(index, index + MARGIN_CHUNK_SIZE);
      const { margins } = await site<{ margins: { id?: string; margin: number | null; spanMargin: number | null }[] }>(
        base,
        cookie,
        "/api/screen/margin",
        {
          method: "POST",
          body: JSON.stringify({
            accountId: account,
            items: chunk.map((row) => ({
              id: row.id,
              instrumentToken: row.instrumentToken,
              exchangeSegment: row.exchangeSegment,
              tradingSymbol: row.tradingSymbol,
              premium: row.premium,
              quantity: row.lotSize * row.lots,
              underlying: row.company,
              expiryIso: row.expiryIso,
              strike: row.strike,
              optionType: row.optionType,
              lots: row.lots,
              lotSize: row.lotSize,
            })),
          }),
        },
      );
      for (const row of chunk) {
        const result = margins.find((margin) => margin.id === row.id);
        if (!result || result.margin === null) {
          continue;
        }
        const positions = basketLegsToSpanPositions([
          {
            exchangeSegment: row.exchangeSegment,
            underlying: row.company,
            expiryIso: row.expiryIso,
            strike: row.strike,
            optionType: row.optionType,
            side: "SELL",
            lots: row.lots,
            lotSize: row.lotSize,
          },
        ]);
        samples.push({
          at: new Date().toISOString(),
          account,
          underlying: row.company,
          exchangeSegment: row.exchangeSegment,
          expiryIso: row.expiryIso,
          optionType: row.optionType,
          strike: row.strike,
          spot: row.spot,
          premium: row.premium,
          lotSize: row.lotSize,
          lots: row.lots,
          kotakMargin: result.margin,
          siteSpanTotal: result.spanMargin,
          span: computePortfolioMargin(positions, loaded.underlyings),
          spanFile,
        });
      }
    }
    if (samples.length > 0) {
      await appendFile(outFile, samples.map((sample) => JSON.stringify(sample)).join("\n") + "\n");
    }
    console.log(`${symbol} ${expiryIso}: ${samples.length} samples (${priced.length} priced options)`);
  }
  console.log(`Saved to ${path.relative(process.cwd(), outFile)}\n`);
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function summarize(label: string, samples: Sample[]): string {
  const gaps = samples.map((sample) => ((sample.span.total - sample.kotakMargin) / sample.kotakMargin) * 100);
  const notional = (sample: Sample) => sample.spot * sample.lotSize * sample.lots;
  const impliedElm = samples.map((sample) => ((sample.kotakMargin - sample.span.span) / notional(sample)) * 100);
  const assumedElm = samples.map((sample) => (sample.span.exposure / notional(sample)) * 100);
  return [
    label.padEnd(20),
    String(samples.length).padStart(4),
    `median ${percent(quantile(gaps, 0.5))}`.padEnd(15),
    `p10..p90 ${percent(quantile(gaps, 0.1))}..${percent(quantile(gaps, 0.9))}`.padEnd(25),
    `ELM implied ${quantile(impliedElm, 0.5).toFixed(2)}% vs assumed ${quantile(assumedElm, 0.5).toFixed(2)}%`,
  ].join("  ");
}

function distanceBucket(sample: Sample): string {
  const distance = (Math.abs(sample.strike - sample.spot) / sample.spot) * 100;
  if (distance < 2) return "OTM <2%";
  if (distance < 5) return "OTM 2-5%";
  if (distance < 10) return "OTM 5-10%";
  return "OTM 10%+";
}

async function report(): Promise<void> {
  const files = (await readdir(CACHE_DIR).catch(() => [])).filter((file) => file.endsWith(".jsonl"));
  const samples: Sample[] = [];
  for (const file of files) {
    const content = await readFile(path.join(CACHE_DIR, file), "utf8");
    samples.push(...content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Sample));
  }
  if (samples.length === 0) {
    console.log("No samples yet.");
    return;
  }
  console.log(`SPAN estimate vs Kotak check-margin across ${files.length} run(s); gap = (SPAN − Kotak) ÷ Kotak\n`);
  console.log(summarize("ALL", samples));
  const groupings: [string, (sample: Sample) => string][] = [
    ["By margin account (Kotak margin is net of that account's open positions)", (sample) => sample.account],
    ["By side", (sample) => sample.optionType],
    ["By distance from spot", distanceBucket],
    ["By underlying", (sample) => sample.underlying],
  ];
  for (const [title, key] of groupings) {
    console.log(`\n${title}`);
    const groups = new Map<string, Sample[]>();
    for (const sample of samples) {
      groups.set(key(sample), [...(groups.get(key(sample)) ?? []), sample]);
    }
    for (const [label, group] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      console.log(summarize(label, group));
    }
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes("--report-only")) {
    await collect();
  }
  await report();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
