import { describe, expect, it } from "vitest";
import type { ScreenCandidate, ScreenSnapshot } from "@/domain/types";
import {
  isAbortError,
  runInvestmentReport,
  type ReportCompanyMeta,
} from "@/lib/investment-report-runner";
import type { ScreenCompanyResult } from "@/lib/screen-company";

function candidate(
  partial: Partial<ScreenCandidate> & { id: string; company: string },
): ScreenCandidate {
  return {
    optionType: "CALL",
    strike: 3000,
    spot: 2500,
    spreadPct: 20,
    priceDiffInr: 500,
    premium: 10,
    hasBid: true,
    lotSize: 250,
    lots: 1,
    fillIndex: 0,
    netPremium: 2000,
    calendarDaysLeft: 30,
    expiryIso: "2026-08-28",
    instrumentToken: "123",
    exchangeSegment: "nse_fo",
    tradingSymbol: `${partial.company}28AUG263000CE`,
    margin: 10000,
    annualizedReturnPct: 40,
    meetsSpread: true,
    meetsReturn: true,
    ...partial,
  };
}

function screenResult(
  company: string,
  qualifying: ScreenCandidate[] = [],
): ScreenCompanyResult {
  const snapshot: ScreenSnapshot = {
    generatedAt: "2026-07-24T00:00:00.000Z",
    company,
    expiryIso: "2026-08-28",
    spot: 2500,
    calendarDaysLeft: 30,
    workingDaysLeft: 20,
    coverage: null,
    candidates: qualifying,
    priceRanges: null,
    priceRangesError: null,
    boardMeeting: null,
    boardMeetingError: null,
  };
  return {
    snapshot,
    candidates: qualifying,
    qualifying,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

describe("isAbortError", () => {
  it("detects DOMException AbortError", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
  });

  it("detects plain objects named AbortError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("runInvestmentReport", () => {
  it("completes a happy path with qualifying rows", async () => {
    const controller = new AbortController();
    const progressStatuses: string[] = [];
    let rows: { company: string }[] = [];

    const result = await runInvestmentReport({
      companies: ["AAA", "BBB"],
      concurrency: 2,
      controller,
      skipped: 0,
      expiryIso: "2026-08-28",
      isCurrent: () => true,
      screenCompany: async (symbol) =>
        screenResult(symbol, [
          candidate({ id: `${symbol}-1`, company: symbol }),
        ]),
      onProgress: (progress) => {
        progressStatuses.push(progress.status);
      },
      onRows: (next) => {
        rows = next;
      },
      onCompanyMeta: () => {},
    });

    expect(result.status).toBe("completed");
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);
    expect(rows).toHaveLength(2);
    expect(progressStatuses.at(-1)).toBe("completed");
  });

  it("treats per-company failures as soft and still completes", async () => {
    const controller = new AbortController();

    const result = await runInvestmentReport({
      companies: ["AAA", "BBB", "CCC"],
      concurrency: 2,
      controller,
      skipped: 0,
      expiryIso: "2026-08-28",
      isCurrent: () => true,
      screenCompany: async (symbol) => {
        if (symbol === "BBB") {
          throw new Error("Unable to screen BBB");
        }
        return screenResult(symbol, [
          candidate({ id: `${symbol}-1`, company: symbol }),
        ]);
      },
      onProgress: () => {},
      onRows: () => {},
      onCompanyMeta: () => {},
    });

    expect(result.status).toBe("completed");
    expect(result.processed).toBe(3);
    expect(result.failed).toBe(1);
    expect(controller.signal.aborted).toBe(false);
  });

  it("returns cancelled when the user aborts mid-run", async () => {
    const controller = new AbortController();
    let sawRunning = false;

    const run = runInvestmentReport({
      companies: ["AAA", "BBB", "CCC", "DDD"],
      concurrency: 1,
      controller,
      skipped: 0,
      expiryIso: "2026-08-28",
      isCurrent: () => true,
      screenCompany: async (symbol, signal) => {
        if (symbol === "BBB") {
          controller.abort();
        }
        await delay(20, signal);
        return screenResult(symbol);
      },
      onProgress: (progress) => {
        if (progress.status === "running") {
          sawRunning = true;
        }
      },
      onRows: () => {},
      onCompanyMeta: () => {},
    });

    const result = await run;
    expect(sawRunning).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(result.reason).toBeUndefined();
  });

  it("aborts siblings and reports error on auth mid-flight (issue #7)", async () => {
    const controller = new AbortController();
    const progressUpdates: { status: string; processed: number }[] = [];
    const rowCounts: number[] = [];
    let slowFinished = false;

    const hangGate = Promise.withResolvers<void>();

    const result = await runInvestmentReport({
      companies: ["SLOW", "AUTH"],
      concurrency: 2,
      controller,
      skipped: 0,
      expiryIso: "2026-08-28",
      isCurrent: () => true,
      screenCompany: async (symbol, signal) => {
        if (symbol === "SLOW") {
          hangGate.resolve();
          try {
            await delay(200, signal);
            slowFinished = true;
            return screenResult(symbol, [
              candidate({ id: "slow-1", company: symbol }),
            ]);
          } catch (err) {
            throw err;
          }
        }
        await hangGate.promise;
        throw Object.assign(new Error("auth_required"), { kind: "auth" });
      },
      onProgress: (progress) => {
        progressUpdates.push({
          status: progress.status,
          processed: progress.processed,
        });
      },
      onRows: (rows) => {
        rowCounts.push(rows.length);
      },
      onCompanyMeta: () => {},
    });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("auth");
    expect(controller.signal.aborted).toBe(true);
    expect(slowFinished).toBe(false);
    expect(progressUpdates.some((u) => u.status === "cancelled")).toBe(false);
    expect(progressUpdates.at(-1)?.status).toBe("error");
    expect(rowCounts.every((count) => count === 0)).toBe(true);

    await delay(50);
    const processedAfter = progressUpdates.at(-1)?.processed ?? 0;
    expect(
      progressUpdates
        .slice()
        .reverse()
        .find((u) => u.status === "error")?.processed,
    ).toBe(processedAfter);
  });

  it("keeps auth as error even when a sibling AbortError wins the Promise.all race", async () => {
    const controller = new AbortController();
    let authThrown = false;

    const result = await runInvestmentReport({
      companies: ["AUTH", "PEER"],
      concurrency: 2,
      controller,
      skipped: 0,
      expiryIso: "2026-08-28",
      isCurrent: () => true,
      screenCompany: async (symbol, signal) => {
        if (symbol === "AUTH") {
          await delay(10, signal);
          authThrown = true;
          throw Object.assign(new Error("auth_required"), { kind: "auth" });
        }
        await delay(5, signal);
        // Stay pending until aborted by the auth path.
        await delay(200, signal);
        return screenResult(symbol);
      },
      onProgress: () => {},
      onRows: () => {},
      onCompanyMeta: () => {},
    });

    expect(authThrown).toBe(true);
    expect(result.status).toBe("error");
    expect(result.reason).toBe("auth");
  });

  it("does not treat a normal company error as cancelled or fatal", async () => {
    const controller = new AbortController();
    let slowFinished = false;
    const hangGate = Promise.withResolvers<void>();

    const result = await runInvestmentReport({
      companies: ["SLOW", "BOOM"],
      concurrency: 2,
      controller,
      skipped: 0,
      expiryIso: "2026-08-28",
      isCurrent: () => true,
      screenCompany: async (symbol, signal) => {
        if (symbol === "SLOW") {
          hangGate.resolve();
          await delay(50, signal);
          slowFinished = true;
          return screenResult(symbol);
        }
        await hangGate.promise;
        throw new Error("Unable to screen BOOM");
      },
      onProgress: () => {},
      onRows: () => {},
      onCompanyMeta: () => {},
    });

    expect(result.status).toBe("completed");
    expect(result.failed).toBe(1);
    expect(slowFinished).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });

  it("reports unexpected error when the pool rejects for a non-company reason", async () => {
    const controller = new AbortController();

    const result = await runInvestmentReport({
      companies: ["AAA"],
      concurrency: 1,
      controller,
      skipped: 0,
      expiryIso: "2026-08-28",
      isCurrent: () => true,
      screenCompany: async () => screenResult("AAA"),
      onProgress: () => {},
      onRows: () => {},
      onCompanyMeta: () => {},
      runPool: async () => {
        throw new Error("pool exploded");
      },
    });

    expect(result.status).toBe("error");
    expect(result.reason).toBe("unexpected");
    expect(controller.signal.aborted).toBe(true);
  });

  it("ignores stale run updates after a newer run starts", async () => {
    let generation = 0;
    const progressByGen: Record<number, string[]> = {};
    const rowsByGen: Record<number, number[]> = {};
    const metaByGen: Record<number, ReportCompanyMeta[]> = {};

    const startRun = (companies: string[], screenMs: number) => {
      const runId = ++generation;
      const controller = new AbortController();
      progressByGen[runId] = [];
      rowsByGen[runId] = [];
      metaByGen[runId] = [];

      const promise = runInvestmentReport({
        companies,
        concurrency: 1,
        controller,
        skipped: 0,
        expiryIso: "2026-08-28",
        isCurrent: () => runId === generation,
        screenCompany: async (symbol, signal) => {
          await delay(screenMs, signal);
          return screenResult(symbol, [
            candidate({ id: `${runId}-${symbol}`, company: symbol }),
          ]);
        },
        onProgress: (progress) => {
          progressByGen[runId].push(progress.status);
        },
        onRows: (rows) => {
          rowsByGen[runId].push(rows.length);
        },
        onCompanyMeta: (meta) => {
          metaByGen[runId].push(meta);
        },
      });

      return { controller, promise, runId };
    };

    const runA = startRun(["AAA"], 80);
    await delay(10);
    runA.controller.abort();
    const runB = startRun(["BBB"], 20);

    const [resultA, resultB] = await Promise.all([runA.promise, runB.promise]);

    expect(resultA.status).toBe("cancelled");
    expect(resultB.status).toBe("completed");
    expect(progressByGen[runA.runId].includes("completed")).toBe(false);
    expect(progressByGen[runB.runId].at(-1)).toBe("completed");
    expect(rowsByGen[runB.runId].at(-1)).toBe(1);
    expect(metaByGen[runA.runId]).toHaveLength(0);
  });
});
