import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAccountId } from "@/config/accounts";
import { getSessionCookieName } from "@/config/env";
import { isKotakApiError } from "@/server/kotak/errors";
import { logError, safeErrorMessage } from "@/server/logging";
import { isSpanError } from "@/server/span/errors";
import { calculateBasketMargin } from "@/server/span/service";
import { requireConnectedAccounts } from "@/server/session";

export const maxDuration = 120;

const legSchema = z.object({
  exchangeSegment: z.string().min(1),
  underlying: z.string().min(1),
  expiryIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strike: z.number().positive(),
  optionType: z.enum(["CALL", "PUT"]),
  side: z.enum(["BUY", "SELL"]),
  lots: z.number().positive(),
  lotSize: z.number().int().positive(),
});

const bodySchema = z.object({
  accountId: z.string().optional(),
  legs: z.array(legSchema).min(1).max(20),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(getSessionCookieName())?.value;
    const sessions = await requireConnectedAccounts(sessionId);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid basket margin request", requestId },
        { status: 400 },
      );
    }

    const accountId = parsed.data.accountId;
    if (accountId !== undefined && !isAccountId(accountId)) {
      return NextResponse.json(
        { error: "Unknown accountId", requestId },
        { status: 400 },
      );
    }

    const result = await calculateBasketMargin({
      legs: parsed.data.legs,
      accountId,
      accountSession: accountId ? sessions[accountId] : undefined,
      requestId,
    });
    return NextResponse.json({ ...result, requestId });
  } catch (error) {
    if (isSpanError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code, requestId },
        { status: error.status },
      );
    }
    if (isKotakApiError(error) && error.code === "session_expired") {
      return NextResponse.json(
        { error: "Login required", code: "login_required", requestId },
        { status: 401 },
      );
    }
    const status =
      typeof error === "object" &&
      error &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    if (status === 401) {
      return NextResponse.json(
        { error: "Login required", code: "login_required", requestId },
        { status: 401 },
      );
    }
    logError("Basket margin failed", {
      requestId,
      message: safeErrorMessage(error),
    });
    return NextResponse.json(
      { error: "Unable to calculate basket margin", requestId },
      { status: 500 },
    );
  }
}
