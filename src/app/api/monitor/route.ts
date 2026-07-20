import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/config/env";
import { isKotakApiError } from "@/server/kotak/errors";
import { getMonitorSnapshot } from "@/server/monitor";
import { requireSession } from "@/server/session";

export async function GET(): Promise<Response> {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(getSessionCookieName())?.value;
    const credentials = requireSession(sessionId);
    const snapshot = await getMonitorSnapshot(credentials);
    return NextResponse.json(snapshot);
  } catch (error) {
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
      return NextResponse.json({ error: "Login required", code: "login_required" }, { status: 401 });
    }

    return NextResponse.json({ error: "Unable to load monitor snapshot" }, { status: 500 });
  }
}
