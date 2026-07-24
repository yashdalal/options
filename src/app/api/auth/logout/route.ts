import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/config/env";
import { clearSession } from "@/server/session";

export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(getSessionCookieName())?.value;
  await clearSession(sessionId);
  cookieStore.delete(getSessionCookieName());
  return NextResponse.json({ status: "logged_out" });
}
