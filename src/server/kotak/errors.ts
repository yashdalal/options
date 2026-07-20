export class KotakApiError extends Error {
  readonly status: number;
  readonly code: "session_expired" | "rate_limited" | "bad_request" | "upstream" | "invalid_response";

  constructor(
    message: string,
    status: number,
    code: KotakApiError["code"] = "upstream",
  ) {
    super(message);
    this.name = "KotakApiError";
    this.status = status;
    this.code = code;
  }
}

export function isKotakApiError(error: unknown): error is KotakApiError {
  return error instanceof KotakApiError;
}
