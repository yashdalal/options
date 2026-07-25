import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
  SpanCalendarSpread,
  SpanContract,
  SpanOptionType,
  SpanUnderlying,
} from "./types";

function parseNumber(raw: string | undefined, fallback = 0): number {
  if (!raw) {
    return fallback;
  }
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : fallback;
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

export function normalizeSpanSymbol(symbol: string): string {
  return decodeXmlText(symbol).trim().toUpperCase();
}

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return decodeXmlText(match?.[1]?.trim() ?? "");
}

function parseRiskArray(raBlock: string): { values: number[]; delta: number } {
  const values = [...raBlock.matchAll(/<a>([^<]*)<\/a>/g)].map((match) =>
    parseNumber(match[1]),
  );
  const delta = parseNumber(tagText(raBlock, "d"));
  return { values, delta };
}

function parseFutures(block: string, symbol: string): SpanContract[] {
  void symbol;
  const contracts: SpanContract[] = [];
  const futRe = /<fut>([\s\S]*?)<\/fut>/g;
  let match: RegExpExecArray | null;
  while ((match = futRe.exec(block))) {
    const fut = match[1];
    const raMatch = fut.match(/<ra>([\s\S]*?)<\/ra>/);
    if (!raMatch) {
      continue;
    }
    const { values, delta } = parseRiskArray(raMatch[1]);
    if (values.length < 16) {
      continue;
    }
    contracts.push({
      instrumentType: "FUT",
      expiry: tagText(fut, "pe"),
      price: parseNumber(tagText(fut, "p")),
      cvf: parseNumber(tagText(fut, "cvf"), 1),
      riskArray: values.slice(0, 16),
      compositeDelta: delta || 1,
    });
  }
  return contracts;
}

function parseOptions(block: string): SpanContract[] {
  const contracts: SpanContract[] = [];
  const seriesRe = /<series>([\s\S]*?)<\/series>/g;
  let seriesMatch: RegExpExecArray | null;
  while ((seriesMatch = seriesRe.exec(block))) {
    const series = seriesMatch[1];
    const expiry = tagText(series, "pe");
    const seriesCvf = parseNumber(tagText(series, "cvf"), 1);
    const optRe = /<opt>([\s\S]*?)<\/opt>/g;
    let optMatch: RegExpExecArray | null;
    while ((optMatch = optRe.exec(series))) {
      const opt = optMatch[1];
      const raMatch = opt.match(/<ra>([\s\S]*?)<\/ra>/);
      if (!raMatch) {
        continue;
      }
      const { values, delta } = parseRiskArray(raMatch[1]);
      if (values.length < 16) {
        continue;
      }
      const optionType = tagText(opt, "o").toUpperCase() as SpanOptionType;
      if (optionType !== "C" && optionType !== "P") {
        continue;
      }
      contracts.push({
        instrumentType: "OPT",
        optionType,
        expiry,
        strike: parseNumber(tagText(opt, "k")),
        price: parseNumber(tagText(opt, "p")),
        cvf: parseNumber(tagText(opt, "cvf"), seriesCvf),
        riskArray: values.slice(0, 16),
        compositeDelta: delta,
      });
    }
  }
  return contracts;
}

function parsePhySpot(block: string): number {
  const phyMatch = block.match(/<phy>([\s\S]*?)<\/phy>/);
  if (!phyMatch) {
    return 0;
  }
  return parseNumber(tagText(phyMatch[1], "p"));
}

function parseCcDef(block: string): {
  symbol: string;
  somRate: number;
  spreads: SpanCalendarSpread[];
} {
  const symbol = tagText(block, "cc").toUpperCase();
  let somRate = 0;
  const somTier = block.match(/<somTiers>([\s\S]*?)<\/somTiers>/);
  if (somTier) {
    for (const rateMatch of somTier[1].matchAll(
      /<rate>[\s\S]*?<val>([^<]*)<\/val>[\s\S]*?<\/rate>/g,
    )) {
      const value = parseNumber(rateMatch[1]);
      if (value > 0) {
        somRate = value;
      }
    }
  }

  const spreads: SpanCalendarSpread[] = [];
  const spreadRe = /<dSpread>([\s\S]*?)<\/dSpread>/g;
  let spreadMatch: RegExpExecArray | null;
  while ((spreadMatch = spreadRe.exec(block))) {
    const spread = spreadMatch[1];
    const legs = [...spread.matchAll(/<pLeg>([\s\S]*?)<\/pLeg>/g)].map(
      (legMatch) => ({
        expiry: tagText(legMatch[1], "pe"),
        side: tagText(legMatch[1], "rs"),
        ratio: parseNumber(tagText(legMatch[1], "i"), 1),
      }),
    );
    const rateMatch = spread.match(/<rate>[\s\S]*?<val>([^<]*)<\/val>/);
    spreads.push({
      priority: parseNumber(tagText(spread, "spread")),
      chargeMethod: tagText(spread, "chargeMeth") || "F",
      rate: parseNumber(rateMatch?.[1]),
      legs,
    });
  }
  spreads.sort((left, right) => left.priority - right.priority);
  return { symbol, somRate, spreads };
}

export type ParsedSpanFile = {
  created?: string;
  underlyings: Map<string, SpanUnderlying>;
};

const CAPTURE_TAGS = ["futPf", "oopPf", "phyPf", "ccDef"] as const;
type CaptureTag = (typeof CAPTURE_TAGS)[number];

function extractTagBlocks(source: string, tag: CaptureTag): string[] {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(open, cursor);
    if (start < 0) {
      break;
    }
    const end = source.indexOf(close, start + open.length);
    if (end < 0) {
      break;
    }
    blocks.push(source.slice(start, end + close.length));
    cursor = end + close.length;
  }
  return blocks;
}

export async function parseSpnStream(path: string): Promise<ParsedSpanFile> {
  const underlyings = new Map<string, SpanUnderlying>();
  const ensure = (symbol: string): SpanUnderlying => {
    const key = normalizeSpanSymbol(symbol);
    let row = underlyings.get(key);
    if (!row) {
      row = {
        symbol: key,
        spot: 0,
        somRate: 0,
        contracts: [],
        spreads: [],
      };
      underlyings.set(key, row);
    }
    return row;
  };

  let created: string | undefined;
  let buffer = "";
  let captureTag: CaptureTag | null = null;

  const flush = (tag: CaptureTag, content: string) => {
    const symbol = normalizeSpanSymbol(
      tagText(content, tag === "ccDef" ? "cc" : "pfCode"),
    );
    if (!symbol) {
      return;
    }
    const row = ensure(symbol);
    if (tag === "futPf") {
      row.contracts.push(...parseFutures(content, symbol));
      return;
    }
    if (tag === "oopPf") {
      row.contracts.push(...parseOptions(content));
      return;
    }
    if (tag === "phyPf") {
      row.spot = parsePhySpot(content) || row.spot;
      return;
    }
    const cc = parseCcDef(content);
    row.somRate = cc.somRate;
    row.spreads = cc.spreads;
  };

  const consumeChunk = (chunk: string) => {
    let remaining = chunk;
    while (remaining.length > 0) {
      if (!captureTag) {
        let nextTag: CaptureTag | null = null;
        let nextIndex = -1;
        for (const tag of CAPTURE_TAGS) {
          const index = remaining.indexOf(`<${tag}>`);
          if (index >= 0 && (nextIndex < 0 || index < nextIndex)) {
            nextIndex = index;
            nextTag = tag;
          }
        }
        if (!nextTag || nextIndex < 0) {
          return;
        }
        captureTag = nextTag;
        remaining = remaining.slice(nextIndex);
        buffer = "";
      }

      const close = `</${captureTag}>`;
      const closeIndex = remaining.indexOf(close);
      if (closeIndex < 0) {
        buffer += remaining;
        return;
      }

      buffer += remaining.slice(0, closeIndex + close.length);
      for (const block of extractTagBlocks(buffer, captureTag)) {
        flush(captureTag, block);
      }
      remaining = remaining.slice(closeIndex + close.length);
      buffer = "";
      captureTag = null;
    }
  };

  const stream = createReadStream(path, { encoding: "latin1" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!created) {
      const createdMatch = line.match(/<created>([^<]+)<\/created>/);
      if (createdMatch) {
        created = createdMatch[1].trim();
      }
    }
    consumeChunk(`${line}\n`);
  }
  if (captureTag && buffer) {
    consumeChunk(`</${captureTag}>`);
  }

  return { created, underlyings };
}
