import { z } from "zod";
import {
  ACCOUNT_DEFINITIONS,
  type AccountDefinition,
  type AccountId,
} from "./accounts";

export type AccountCredentials = {
  id: AccountId;
  label: string;
  accessToken: string;
  mobileNumber: string;
  ucc: string;
  mpin: string;
};

export type AppEnv = {
  accounts: AccountCredentials[];
  KOTAK_LOGIN_BASE_URL: string;
  KOTAK_NEO_FIN_KEY: string;
  HIGHLIGHT_DEFAULT: number;
  SESSION_COOKIE_NAME: string;
};

function resolveAccessToken(prefix: string): string {
  const raw =
    process.env[`${prefix}_ACCESS_TOKEN`]?.trim() ||
    process.env[`${prefix}_CONSUMER_KEY`]?.trim() ||
    "";
  return raw.replace(/^Bearer\s+/i, "").trim();
}

const accountCredentialSchema = z.object({
  accessToken: z.string().min(1, "ACCESS_TOKEN / CONSUMER_KEY is required"),
  mobileNumber: z
    .string()
    .regex(/^\+91\d{10}$/, "MOBILE_NUMBER must look like +91XXXXXXXXXX"),
  ucc: z.string().min(1, "UCC is required"),
  mpin: z.string().regex(/^\d{6}$/, "MPIN must be 6 digits"),
});

const sharedEnvSchema = z.object({
  KOTAK_LOGIN_BASE_URL: z
    .string()
    .url()
    .default("https://mis.kotaksecurities.com"),
  KOTAK_NEO_FIN_KEY: z.string().default("neotradeapi"),
  HIGHLIGHT_DEFAULT: z.coerce.number().positive().default(10),
  SESSION_COOKIE_NAME: z.string().default("near_expiry_session"),
});

function readAccountCredentials(definition: AccountDefinition): AccountCredentials {
  const prefix = definition.envPrefix;
  const parsed = accountCredentialSchema.safeParse({
    accessToken: resolveAccessToken(prefix),
    mobileNumber: process.env[`${prefix}_MOBILE_NUMBER`]?.trim() ?? "",
    ucc: process.env[`${prefix}_UCC`]?.trim() ?? "",
    mpin: process.env[`${prefix}_MPIN`]?.trim() ?? "",
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${prefix}_${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return {
    id: definition.id,
    label: definition.label,
    accessToken: parsed.data.accessToken,
    mobileNumber: parsed.data.mobileNumber,
    ucc: parsed.data.ucc,
    mpin: parsed.data.mpin,
  };
}

function hasAccountCredentials(definition: AccountDefinition): boolean {
  const prefix = definition.envPrefix;
  return Boolean(
    resolveAccessToken(prefix) &&
      process.env[`${prefix}_MOBILE_NUMBER`] &&
      process.env[`${prefix}_UCC`] &&
      process.env[`${prefix}_MPIN`],
  );
}

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) {
    return cached;
  }

  const shared = sharedEnvSchema.safeParse(process.env);
  if (!shared.success) {
    const details = shared.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cached = {
    accounts: ACCOUNT_DEFINITIONS.map(readAccountCredentials),
    ...shared.data,
  };
  return cached;
}

export function getAccountCredentials(accountId: AccountId): AccountCredentials {
  const account = getEnv().accounts.find((item) => item.id === accountId);
  if (!account) {
    throw new Error(`Unknown account id: ${accountId}`);
  }
  return account;
}

export function listAccountCredentials(): AccountCredentials[] {
  return getEnv().accounts;
}

export function getHighlightDefault(): number {
  const raw = process.env.HIGHLIGHT_DEFAULT;
  if (!raw) {
    return 10;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

export function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || "near_expiry_session";
}

export function hasKotakCredentials(): boolean {
  return ACCOUNT_DEFINITIONS.every(hasAccountCredentials);
}
