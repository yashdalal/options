import { KotakApiError } from "./errors";
import { logWarn } from "../logging";

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

  return parsed.origin;
}

export type RequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  formUrlEncoded?: boolean;
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
        if (options.formUrlEncoded) {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
          body =
            typeof options.body === "string"
              ? options.body
              : new URLSearchParams(
                  Object.entries(options.body as Record<string, string>).map(
                    ([key, value]) => [key, String(value)],
                  ),
                ).toString();
        } else {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(options.body);
        }
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

        throw new KotakApiError(
          `Kotak request failed with status ${response.status}`,
          response.status,
          code,
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
