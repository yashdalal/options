import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionCookieName } from "@/config/env";
import { isKotakApiError } from "@/server/kotak/errors";
import { logError, safeErrorMessage } from "@/server/logging";
import { getScreenMargins } from "@/server/screen";
import { requireConnectedAccounts } from "@/server/session";

const bodySchema = z.object({
  accountId: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        instrumentToken: z.string().min(1),
        exchangeSegment: z.string().optional(),
        tradingSymbol: z.string().optional(),
        premium: z.number().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .max(40),
});

function errorResponse(error: unknown, requestId: string, fallback: string): Response {
  const status =
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : isKotakApiError(error)
        ? error.status
        : 500;

  const code =
    typeof error === "object" &&
    error &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "upstream";

  if (status === 401 || code === "login_required" || code === "session_expired") {
    return NextResponse.json(
      { error: "Login required", code: "login_required", requestId },
      { status: 401 },
    );
  }

  logError(fallback, {
    requestId,
    message: safeErrorMessage(error),
    name: error instanceof Error ? error.name : "UnknownError",
    code,
    status,
  });
  return NextResponse.json({ error: fallback, requestId }, { status: 500 });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(getSessionCookieName())?.value;
    const sessions = await requireConnectedAccounts(sessionId);
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid margin request", requestId },
        { status: 400 },
      );
    }

    const margins = await getScreenMargins(
      sessions,
      parsed.data.items,
      parsed.data.accountId,
      requestId,
      sessionId,
    );
    return NextResponse.json({ margins });
  } catch (error) {
    return errorResponse(error, requestId, "Unable to load margins");
  }
}
