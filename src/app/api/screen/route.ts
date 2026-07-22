import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/config/env";
import type { ScreenSideFilter } from "@/domain/types";
import { isKotakApiError } from "@/server/kotak/errors";
import { logError, safeErrorMessage } from "@/server/logging";
import { getScreenSnapshot } from "@/server/screen";
import { requireConnectedAccounts } from "@/server/session";

function parseNumber(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSide(value: string | null): ScreenSideFilter {
  if (value === "CALL" || value === "PUT" || value === "BOTH") {
    return value;
  }
  return "BOTH";
}

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

export async function GET(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(getSessionCookieName())?.value;
    const sessions = requireConnectedAccounts(sessionId);
    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
    const expiryIso = (url.searchParams.get("expiry") ?? "").trim();
    if (!symbol || !expiryIso) {
      return NextResponse.json(
        { error: "symbol and expiry are required", requestId },
        { status: 400 },
      );
    }

    const snapshot = await getScreenSnapshot(
      sessions,
      {
        symbol,
        expiryIso,
        spreadMin: parseNumber(url.searchParams.get("spreadMin"), 18),
        returnMin: parseNumber(url.searchParams.get("returnMin"), 24),
        side: parseSide(url.searchParams.get("side")),
        lots: Math.max(1, Math.floor(parseNumber(url.searchParams.get("lots"), 1))),
      },
      requestId,
    );
    return NextResponse.json(snapshot);
  } catch (error) {
    return errorResponse(error, requestId, "Unable to load screener snapshot");
  }
}
