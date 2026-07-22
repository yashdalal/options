import { z } from "zod";
import { kotakFetch } from "./client";
import { KotakApiError } from "./errors";
import type { TradeSessionCredentials } from "./auth";
import { getKotakRateLimiter } from "./rate-limit";

const marginResponseSchema = z
  .object({
    data: z
      .object({
        totMrgnUsd: z.union([z.string(), z.number()]).optional(),
        mrgnUsd: z.union([z.string(), z.number()]).optional(),
        ordMrgn: z.union([z.string(), z.number()]).optional(),
        reqdMrgn: z.union([z.string(), z.number()]).optional(),
        rmsVldtd: z.string().optional(),
        stat: z.string().optional(),
        stCode: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
    totMrgnUsd: z.union([z.string(), z.number()]).optional(),
    mrgnUsd: z.union([z.string(), z.number()]).optional(),
    ordMrgn: z.union([z.string(), z.number()]).optional(),
    reqdMrgn: z.union([z.string(), z.number()]).optional(),
    stat: z.string().optional(),
    stCode: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type CheckMarginInput = {
  instrumentToken: string;
  exchangeSegment?: string;
  price: number;
  quantity: number;
  transactionType?: "B" | "S";
  product?: string;
  orderType?: string;
  tradingSymbol?: string;
};

export type CheckMarginResult = {
  instrumentToken: string;
  totalMarginUsed: number | null;
  raw: unknown;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveTotalMargin(payload: unknown): number | null {
  const parsed = marginResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data.data ?? parsed.data;
  return (
    toNumber(data.totMrgnUsd) ??
    toNumber(data.mrgnUsd) ??
    toNumber(data.ordMrgn) ??
    toNumber(data.reqdMrgn)
  );
}

export async function checkMargin(
  session: TradeSessionCredentials,
  input: CheckMarginInput,
): Promise<CheckMarginResult> {
  const limiter = getKotakRateLimiter();
  return limiter.schedule(async () => {
    const jData: Record<string, string> = {
      brkName: "KOTAK",
      brnchId: "ONLINE",
      exSeg: input.exchangeSegment ?? "nse_fo",
      prc: String(input.price),
      prcTp: input.orderType ?? "L",
      prod: input.product ?? "NRML",
      qty: String(input.quantity),
      tok: input.instrumentToken,
      trnsTp: input.transactionType ?? "S",
    };
    if (input.tradingSymbol) {
      jData.ts = input.tradingSymbol;
    }

    const payload = await kotakFetch(`${session.baseUrl}/quick/user/check-margin`, {
      method: "POST",
      bodyEncoding: "form",
      headers: {
        Auth: session.tradingToken,
        Sid: session.tradingSid,
        "neo-fin-key": session.neoFinKey,
      },
      body: { jData: JSON.stringify(jData) },
    });

    const totalMarginUsed = resolveTotalMargin(payload);
    if (totalMarginUsed === null) {
      throw new KotakApiError(
        "Margin response missing totMrgnUsd",
        500,
        "invalid_response",
        payload,
      );
    }

    return {
      instrumentToken: input.instrumentToken,
      totalMarginUsed,
      raw: payload,
    };
  });
}
