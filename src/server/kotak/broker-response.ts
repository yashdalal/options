function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFailureStatus(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "");
  return normalized === "error" || normalized === "failed" || normalized === "notok";
}

export function detectBrokerFailure(payload: unknown): { message: string } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const status = String(record.status ?? record.stat ?? "");
  const nested =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null;
  const nestedStatus = String(nested?.status ?? nested?.stat ?? "");

  const failed =
    isFailureStatus(status) ||
    isFailureStatus(nestedStatus) ||
    nonEmptyString(record.error) ||
    nonEmptyString(record.errMsg) ||
    nonEmptyString(record.emsg);

  if (!failed) {
    return null;
  }

  const message =
    (nonEmptyString(record.message) && record.message.trim()) ||
    (nonEmptyString(record.errMsg) && record.errMsg.trim()) ||
    (nonEmptyString(record.emsg) && record.emsg.trim()) ||
    (nonEmptyString(record.error) && record.error.trim()) ||
    "";

  return { message };
}
