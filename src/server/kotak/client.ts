import { KotakApiError } from "./errors";
import { logError, logWarn } from "../logging";

function extractBrokerMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" && payload.trim() ? payload.trim() : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = extractBrokerMessage(item);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  const record = payload as Record<string, unknown>;
  for (const key of [
    "message",
    "Message",
    "Error Message",
    "errMsg",
    "error",
    "emsg",
    "msg",
    "description",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value) || (value && typeof value === "object")) {
      const nested = extractBrokerMessage(value);
      if (nested) {
        return nested;
      }
    }
  }

  if (record.data && typeof record.data === "object") {
    return extractBrokerMessage(record.data);
  }

  return null;
}

const APPROVED_HOST_SUFFIXES = [
  "kotaksecurities.com",
  "kotak.com",
];

export function assertApprovedBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new KotakApiError("Invalid broker base URL", 500, "invalid_response");
  }

  if (parsed.protocol !== "https:") {
    throw new KotakApiError("Broker base URL must use HTTPS", 500, "invalid_response");
  }

  const host = parsed.hostname.toLowerCase();
  const approved = APPROVED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
  if (!approved) {
    throw new KotakApiError("Broker base URL host is not approved", 500, "invalid_response");
  }

  if (parsed.search || parsed.hash) {
    throw new KotakApiError(
      "Broker base URL must not contain a query or fragment",
      500,
      "invalid_response",
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export type RequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyStatus(status: number): KotakApiError["code"] {
  if (status === 403) {
    return "session_expired";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 400 && status < 500) {
    return "bad_request";
  }
  return "upstream";
}

export async function kotakFetch(
  url: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxRetries = options.retries ?? 2;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(options.headers ?? {}),
      };

      let body: string | undefined;
      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.body);
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      if (!response.ok) {
        const code = classifyStatus(response.status);
        const retryable =
          response.status === 429 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (retryable && attempt < maxRetries) {
          attempt += 1;
          const delay = Math.min(2000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
          logWarn("Retrying Kotak request", { url, status: response.status, attempt });
          await sleep(delay);
          continue;
        }

        const brokerMessage = extractBrokerMessage(payload);
        logError("Kotak request failed", {
          url,
          status: response.status,
          payload,
        });
        throw new KotakApiError(
          brokerMessage ?? `Kotak request failed with status ${response.status}`,
          response.status,
          code,
          payload,
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof KotakApiError) {
        throw error;
      }
      if (attempt < maxRetries) {
        attempt += 1;
        const delay = Math.min(2000, 250 * 2 ** attempt);
        logWarn("Retrying Kotak request after transport error", { url, attempt });
        await sleep(delay);
        continue;
      }
      throw new KotakApiError(
        error instanceof Error ? error.message : "Kotak request failed",
        500,
        "upstream",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
