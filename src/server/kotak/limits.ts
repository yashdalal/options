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
    stat: z.string().optional(),
    stCode: numericValueSchema.optional(),
  })
  .passthrough();

const wrappedLimitsResponseSchema = z
  .object({ data: limitsDataSchema })
  .passthrough();

function parseNonNegativeNumber(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseUsedMargin(payload: unknown): number {
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

  return usedMargin;
}

export async function fetchUsedMargin(
  session: TradeSessionCredentials,
): Promise<number> {
  if (isDemoMode()) {
    return demoFetchUsedMargin(session);
  }

  return getKotakRateLimiter().schedule(async () => {
    const payload = await kotakFetch(`${session.baseUrl}/quick/user/limits`, {
      method: "POST",
      bodyEncoding: "form",
      headers: {
        Auth: session.tradingToken,
        Sid: session.tradingSid,
        "neo-fin-key": session.neoFinKey,
      },
      body: {
        seg: "ALL",
        exch: "ALL",
        prod: "ALL",
      },
    });
    return parseUsedMargin(payload);
  });
}
