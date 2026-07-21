const SECRET_PATTERNS = [
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  /\+91\d{10}/g,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
];

const SENSITIVE_KEYS = new Set([
  "token",
  "sid",
  "auth",
  "authorization",
  "mpin",
  "totp",
  "access_token",
  "accesstoken",
  "mobile",
  "mobilenumber",
  "ucc",
  "actid",
  "usrid",
  "nordno",
  "exordid",
  "flid",
]);

export function redactString(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactValue(nested);
      }
    }
    return output;
  }
  return value;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return redactString(error.message);
  }
  return "Unexpected error";
}

export function logError(message: string, details?: unknown): void {
  if (details === undefined) {
    console.error(message);
    return;
  }
  console.error(message, JSON.stringify(redactValue(details), null, 2));
}

export function logInfo(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(message);
    return;
  }
  console.info(message, JSON.stringify(redactValue(details), null, 2));
}

export function logWarn(message: string, details?: unknown): void {
  if (details === undefined) {
    console.warn(message);
    return;
  }
  console.warn(message, JSON.stringify(redactValue(details), null, 2));
}
