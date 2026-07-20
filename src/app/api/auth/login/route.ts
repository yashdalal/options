import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionCookieName, hasKotakCredentials } from "@/config/env";
import { isKotakApiError } from "@/server/kotak/errors";
import { establishSession } from "@/server/session";

const bodySchema = z.object({
  totp: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request): Promise<Response> {
  try {
    if (!hasKotakCredentials()) {
      return NextResponse.json(
        { error: "Server is missing Kotak credentials in .env.local" },
        { status: 500 },
      );
    }

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid 6-digit TOTP" }, { status: 400 });
    }

    const { sessionId } = await establishSession(parsed.data.totp);
    const cookieStore = await cookies();
    cookieStore.set(getSessionCookieName(), sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });

    return NextResponse.json({ status: "authenticated" });
  } catch (error) {
    const status = isKotakApiError(error) && error.status < 500 ? 401 : 500;
    return NextResponse.json(
      { error: status === 401 ? "Authentication failed" : "Unable to authenticate" },
      { status },
    );
  }
}
