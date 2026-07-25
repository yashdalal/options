import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/config/env";
import { isSpanError } from "@/server/span/errors";
import { ensureSpanSnapshot } from "@/server/span/service";
import { logError, safeErrorMessage } from "@/server/logging";
import { requireConnectedAccounts } from "@/server/session";

export const maxDuration = 120;

export async function POST(): Promise<Response> {
  const requestId = randomUUID();
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(getSessionCookieName())?.value;
    await requireConnectedAccounts(sessionId);
    const meta = await ensureSpanSnapshot({ force: true });
    return NextResponse.json({
      spanFile: {
        date: meta.date,
        variant: meta.variant,
        exposureSource: meta.exposureSource,
        fetchedAt: meta.fetchedAt,
        underlyingCount: meta.underlyingCount,
      },
      requestId,
    });
  } catch (error) {
    if (isSpanError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code, requestId },
        { status: error.status },
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
    logError("SPAN refresh failed", {
      requestId,
      message: safeErrorMessage(error),
    });
    return NextResponse.json(
      { error: "Unable to refresh SPAN snapshot", requestId },
      { status: 500 },
    );
  }
}
