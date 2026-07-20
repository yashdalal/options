import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionCookieName } from "@/config/env";
import { clearSession } from "@/server/session";

export async function POST(): Promise<Response> {
  await clearSession();
  const cookieStore = await cookies();
  cookieStore.delete(getSessionCookieName());
  return NextResponse.json({ status: "logged_out" });
}
