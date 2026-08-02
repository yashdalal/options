import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { demoRefreshSpanSnapshot } from "@/server/demo/adapters/span";
import { isDemoMode } from "@/server/demo/mode";
import { logInfo, logWarn } from "../logging";
import { SpanError } from "./errors";
import { parseSpnStream } from "./parse";
import { writeSpanSnapshot } from "./store";
import type { SpanSnapshotMeta } from "./types";
import {
  NSE_USER_AGENT,
  SPAN_VARIANTS,
  istCalendarDate,
  previousCalendarDates,
  spanZipUrl,
  type SpanVariant,
} from "./urls";

export type SpanProbeResult = {
  ok: boolean;
  date: string;
  variant: string | null;
  url: string | null;
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
  error?: string;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function headSpan(
  date: string,
  variant: SpanVariant,
): Promise<{ status: number; contentType: string | null; contentLength: number | null; url: string }> {
  const url = spanZipUrl(date, variant);
  // Prefer ranged GET over HEAD — some NSE edges stall on HEAD.
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "User-Agent": NSE_USER_AGENT,
        Range: "bytes=0-0",
      },
      cache: "no-store",
    },
    8_000,
  );
  await response.arrayBuffer().catch(() => undefined);
  const contentLengthRaw =
    response.headers.get("content-range")?.split("/")[1] ??
    response.headers.get("content-length");
  return {
    status: response.status === 206 ? 200 : response.status,
    contentType: response.headers.get("content-type"),
    contentLength: contentLengthRaw ? Number(contentLengthRaw) : null,
    url,
  };
}

export async function resolveLatestSpanFile(
  lookbackDays = 10,
): Promise<{ date: string; variant: SpanVariant; url: string }> {
  const today = istCalendarDate();
  const dates = previousCalendarDates(today, lookbackDays);
  let lastError: string | null = null;

  for (const date of dates) {
    for (const variant of SPAN_VARIANTS) {
      try {
        const head = await headSpan(date, variant);
        if (head.status === 200) {
          return { date, variant, url: head.url };
        }
        lastError = `${head.url} → HTTP ${head.status}`;
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.name === "AbortError"
              ? `timeout for ${spanZipUrl(date, variant)}`
              : error.message
            : "span_head_failed";
      }
    }
  }

  throw new SpanError(
    `No SPAN zip found in the last ${lookbackDays} sessions${lastError ? ` (${lastError})` : ""}`,
    503,
    "span_unavailable",
  );
}

export async function probeSpanFetch(): Promise<SpanProbeResult> {
  try {
    const latest = await resolveLatestSpanFile(5);
    const head = await headSpan(latest.date, latest.variant);
    return {
      ok: head.status === 200,
      date: latest.date,
      variant: latest.variant,
      url: head.url,
      status: head.status,
      contentType: head.contentType,
      contentLength: head.contentLength,
      error: head.status === 200 ? undefined : `HTTP ${head.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      date: istCalendarDate(),
      variant: null,
      url: null,
      status: null,
      contentType: null,
      contentLength: null,
      error: error instanceof Error ? error.message : "probe_failed",
    };
  }
}

async function downloadZip(url: string, destPath: string): Promise<void> {
  const response = await fetchWithTimeout(
    url,
    {
      headers: { "User-Agent": NSE_USER_AGENT },
      cache: "no-store",
    },
    60_000,
  );
  if (!response.ok) {
    throw new SpanError(
      `SPAN download failed: HTTP ${response.status} for ${url}`,
      502,
      "span_download_failed",
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
}

function extractSpn(zipPath: string, destDir: string): string {
  const zipBytes = readFileSync(zipPath);
  const files = unzipSync(new Uint8Array(zipBytes));
  const entryName = Object.keys(files).find((name) =>
    name.toLowerCase().endsWith(".spn"),
  );
  if (!entryName) {
    throw new SpanError("SPAN zip contained no .spn file", 502, "span_invalid_zip");
  }
  const spnPath = join(destDir, entryName.split("/").pop() ?? "span.spn");
  writeFileSync(spnPath, Buffer.from(files[entryName]));
  return spnPath;
}

export async function refreshSpanSnapshot(options?: {
  force?: boolean;
}): Promise<SpanSnapshotMeta> {
  if (isDemoMode()) {
    return demoRefreshSpanSnapshot(options);
  }

  const latest = await resolveLatestSpanFile();
  logInfo("Refreshing SPAN snapshot", {
    date: latest.date,
    variant: latest.variant,
    url: latest.url,
    force: Boolean(options?.force),
  });

  const workDir = await mkdtemp(join(tmpdir(), "span-"));
  const zipPath = join(workDir, `nsccl.${latest.date}.${latest.variant}.zip`);

  try {
    await mkdir(workDir, { recursive: true });
    await downloadZip(latest.url, zipPath);
    const spnPath = extractSpn(zipPath, workDir);
    const parsed = await parseSpnStream(spnPath);
    if (parsed.underlyings.size === 0) {
      throw new SpanError("SPAN parse produced zero underlyings", 500, "span_empty");
    }
    const meta = await writeSpanSnapshot(
      {
        date: latest.date,
        variant: latest.variant,
        created: parsed.created,
      },
      parsed.underlyings,
    );
    logInfo("SPAN snapshot cached", {
      date: meta.date,
      variant: meta.variant,
      underlyingCount: meta.underlyingCount,
    });
    return meta;
  } catch (error) {
    logWarn("SPAN refresh failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
