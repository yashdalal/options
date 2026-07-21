import { z } from "zod";

function resolveConsumerKey(): string {
  const raw =
    process.env.KOTAK_ACCESS_TOKEN?.trim() ||
    process.env.KOTAK_CONSUMER_KEY?.trim() ||
    "";
  return raw.replace(/^Bearer\s+/i, "").trim();
}

const envSchema = z.object({
  KOTAK_ACCESS_TOKEN: z.string().min(1, "KOTAK_ACCESS_TOKEN / KOTAK_CONSUMER_KEY is required"),
  KOTAK_MOBILE_NUMBER: z
    .string()
    .regex(/^\+91\d{10}$/, "KOTAK_MOBILE_NUMBER must look like +91XXXXXXXXXX"),
  KOTAK_UCC: z.string().min(1, "KOTAK_UCC is required"),
  KOTAK_MPIN: z.string().regex(/^\d{6}$/, "KOTAK_MPIN must be 6 digits"),
  KOTAK_LOGIN_BASE_URL: z
    .string()
    .url()
    .default("https://mis.kotaksecurities.com"),
  KOTAK_NEO_FIN_KEY: z.string().default("neotradeapi"),
  HIGHLIGHT_DEFAULT: z.coerce.number().positive().default(10),
  SESSION_COOKIE_NAME: z.string().default("near_expiry_session"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse({
    ...process.env,
    KOTAK_ACCESS_TOKEN: resolveConsumerKey(),
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cached = parsed.data;
  return cached;
}

export function getHighlightDefault(): number {
  const raw = process.env.HIGHLIGHT_DEFAULT;
  if (!raw) {
    return 10;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE?.trim().toLowerCase() === "true";
}

export function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || "near_expiry_session";
}

export function hasKotakCredentials(): boolean {
  return Boolean(
    resolveConsumerKey() &&
      process.env.KOTAK_MOBILE_NUMBER &&
      process.env.KOTAK_UCC &&
      process.env.KOTAK_MPIN,
  );
}
