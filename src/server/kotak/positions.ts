import { z } from "zod";
import { kotakFetch } from "./client";
import { detectBrokerFailure } from "./broker-response";
import { KotakApiError } from "./errors";
import type { TradeSessionCredentials } from "./auth";
import { logError, logInfo, safeErrorMessage } from "../logging";

const positionRowSchema = z
  .object({
    tok: z.union([z.string(), z.number()]).optional(),
    trdSym: z.string().optional(),
    sym: z.string().optional(),
    exSeg: z.string().optional(),
    optTp: z.string().optional(),
    stkPrc: z.union([z.string(), z.number()]).optional(),
    expDt: z.string().optional(),
    exp: z.string().optional(),
    lotSz: z.union([z.string(), z.number()]).optional(),
    multiplier: z.union([z.string(), z.number()]).optional(),
    precision: z.union([z.string(), z.number()]).optional(),
    prod: z.string().optional(),
    it: z.string().optional(),
    avgPrc: z.union([z.string(), z.number()]).optional(),
    qty: z.union([z.string(), z.number()]).optional(),
    cfBuyQty: z.union([z.string(), z.number()]).optional(),
    flBuyQty: z.union([z.string(), z.number()]).optional(),
    cfSellQty: z.union([z.string(), z.number()]).optional(),
    flSellQty: z.union([z.string(), z.number()]).optional(),
    buyAmt: z.union([z.string(), z.number()]).optional(),
    sellAmt: z.union([z.string(), z.number()]).optional(),
    cfBuyAmt: z.union([z.string(), z.number()]).optional(),
    cfSellAmt: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const positionsResponseSchema = z.object({
  stat: z.string().optional(),
  stCode: z.union([z.string(), z.number()]).optional(),
  data: z.array(positionRowSchema).default([]),
});

export type RawPosition = z.infer<typeof positionRowSchema>;

function summarizePayload(payload: unknown): Record<string, unknown> {
  if (payload === null) {
    return { payloadType: "null" };
  }
  if (Array.isArray(payload)) {
    return { payloadType: "array", itemCount: payload.length };
  }
  if (typeof payload !== "object") {
    return { payloadType: typeof payload };
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;
  return {
    payloadType: "object",
    topLevelKeys: Object.keys(record).sort(),
    stat: record.stat,
    status: record.status,
    stCode: record.stCode,
    errMsg: record.errMsg,
    dataType: data === null ? "null" : Array.isArray(data) ? "array" : typeof data,
    dataCount: Array.isArray(data) ? data.length : undefined,
  };
}

export async function fetchPositions(
  session: TradeSessionCredentials,
  requestId?: string,
): Promise<RawPosition[]> {
  const startedAt = Date.now();
  const host = new URL(session.baseUrl).hostname;
  let payload: unknown;

  try {
    payload = await kotakFetch(`${session.baseUrl}/quick/user/positions`, {
      method: "GET",
      headers: {
        Auth: session.tradingToken,
        Sid: session.tradingSid,
        "neo-fin-key": session.neoFinKey,
      },
    });
  } catch (error) {
    logError("Kotak positions request failed", {
      requestId,
      host,
      elapsedMs: Date.now() - startedAt,
      name: error instanceof Error ? error.name : "UnknownError",
      message: safeErrorMessage(error),
      status: error instanceof KotakApiError ? error.status : undefined,
      code: error instanceof KotakApiError ? error.code : undefined,
    });
    throw error;
  }

  const summary = summarizePayload(payload);
  logInfo("Kotak positions response received", {
    requestId,
    host,
    elapsedMs: Date.now() - startedAt,
    ...summary,
  });

  const failure = detectBrokerFailure(payload);
  if (failure) {
    logError("Kotak positions rejected", {
      requestId,
      host,
      ...summary,
    });
    throw new KotakApiError(
      failure.message || "Positions request failed",
      502,
      "bad_request",
      payload,
    );
  }

  const parsed = positionsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    logError("Unexpected Kotak positions response shape", {
      requestId,
      host,
      ...summary,
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    });
    throw new KotakApiError("Unexpected positions response", 500, "invalid_response");
  }

  return parsed.data.data;
}
