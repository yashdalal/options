import { z } from "zod";
import { demoFetchUsedMargin } from "@/server/demo/adapters/limits";
import { isDemoMode } from "@/server/demo/mode";
import type { TradeSessionCredentials } from "./auth";
import { detectBrokerFailure } from "./broker-response";
import { kotakFetch } from "./client";
import { KotakApiError } from "./errors";
import { getKotakRateLimiter } from "./rate-limit";

const numericValueSchema = z.union([z.string(), z.number()]);

const limitsDataSchema = z
  .object({
    MarginUsed: numericValueSchema,
    TimeStamp: numericValueSchema.optional(),
    stat: z.string().optional(),
    stCode: numericValueSchema.optional(),
  })
  .passthrough();

const wrappedLimitsResponseSchema = z
  .object({ data: limitsDataSchema })
  .passthrough();

export type UsedMarginResult = {
  usedMargin: number;
  brokerUpdatedAt: string | null;
};

function parseNonNegativeNumber(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseBrokerTimestamp(value: string | number | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const timestamp = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseUsedMargin(payload: unknown): UsedMarginResult {
  const failure = detectBrokerFailure(payload);
  if (failure) {
    throw new KotakApiError(
      failure.message || "Limits request failed",
      502,
      "bad_request",
      payload,
    );
  }

  const wrapped = wrappedLimitsResponseSchema.safeParse(payload);
  const direct = limitsDataSchema.safeParse(payload);
  const data = wrapped.success ? wrapped.data.data : direct.success ? direct.data : null;
  if (!data) {
    throw new KotakApiError(
      "Unexpected limits response shape",
      500,
      "invalid_response",
      payload,
    );
  }

  const usedMargin = parseNonNegativeNumber(data.MarginUsed);
  if (usedMargin === null) {
    throw new KotakApiError(
      "Limits response has invalid MarginUsed",
      500,
      "invalid_response",
      payload,
    );
  }

  return {
    usedMargin,
    brokerUpdatedAt: parseBrokerTimestamp(data.TimeStamp),
  };
}

export async function fetchUsedMargin(
  session: TradeSessionCredentials,
): Promise<UsedMarginResult> {
  if (isDemoMode()) {
    return demoFetchUsedMargin(session);
  }

  const url = new URL(`${session.baseUrl}/quick/user/limits`);
  url.searchParams.set("segment", "ALL");
  url.searchParams.set("exchange", "ALL");
  url.searchParams.set("product", "ALL");

  return getKotakRateLimiter().schedule(async () => {
    const payload = await kotakFetch(url.toString(), {
      method: "GET",
      headers: {
        Auth: session.tradingToken,
        Sid: session.tradingSid,
        "neo-fin-key": session.neoFinKey,
      },
    });
    return parseUsedMargin(payload);
  });
}
