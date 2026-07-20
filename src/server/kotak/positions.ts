import { z } from "zod";
import { kotakFetch } from "./client";
import { KotakApiError } from "./errors";
import type { TradeSessionCredentials } from "./auth";

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

export async function fetchPositions(
  session: TradeSessionCredentials,
): Promise<RawPosition[]> {
  const payload = await kotakFetch(`${session.baseUrl}/quick/user/positions`, {
    method: "GET",
    headers: {
      Auth: session.tradingToken,
      Sid: session.tradingSid,
      "neo-fin-key": session.neoFinKey,
    },
  });

  const parsed = positionsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new KotakApiError("Unexpected positions response", 500, "invalid_response");
  }

  return parsed.data.data;
}
