export class SpanError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "span_error") {
    super(message);
    this.name = "SpanError";
    this.status = status;
    this.code = code;
  }
}

export function isSpanError(error: unknown): error is SpanError {
  return error instanceof SpanError;
}
