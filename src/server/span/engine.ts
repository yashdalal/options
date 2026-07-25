import { exposureRate, notionalValue } from "./exposure";
import { SpanError } from "./errors";
import type {
  MarginBreakdown,
  SpanContract,
  SpanPosition,
  SpanUnderlying,
} from "./types";

type Resolved = {
  underlying: SpanUnderlying;
  contract: SpanContract;
  quantity: number;
};

function expiryKey(expiryIso: string): string {
  return expiryIso.replaceAll("-", "");
}

function findContract(
  underlying: SpanUnderlying,
  position: SpanPosition,
): SpanContract | null {
  const expiry = expiryKey(position.expiryIso);
  if (position.instrumentType === "FUT") {
    return (
      underlying.contracts.find(
        (contract) =>
          contract.instrumentType === "FUT" && contract.expiry === expiry,
      ) ?? null
    );
  }

  const optionType = position.optionType === "PUT" ? "P" : "C";
  const strike = position.strike;
  if (strike === undefined) {
    return null;
  }
  return (
    underlying.contracts.find(
      (contract) =>
        contract.instrumentType === "OPT" &&
        contract.optionType === optionType &&
        contract.expiry === expiry &&
        Math.abs((contract.strike ?? NaN) - strike) < 1e-6,
    ) ?? null
  );
}

function scanRisk(resolved: Resolved[]): {
  scanRisk: number;
  scenarioLosses: number[];
} {
  const losses = Array.from({ length: 16 }, () => 0);
  for (const row of resolved) {
    for (let index = 0; index < 16; index += 1) {
      losses[index] += row.quantity * row.contract.riskArray[index];
    }
  }
  return {
    scanRisk: Math.max(0, ...losses),
    scenarioLosses: losses,
  };
}

function calendarSpreadCharge(
  underlying: SpanUnderlying,
  resolved: Resolved[],
): number {
  const netDelta = new Map<string, number>();
  for (const row of resolved) {
    const expiry = row.contract.expiry;
    netDelta.set(
      expiry,
      (netDelta.get(expiry) ?? 0) +
        row.quantity * row.contract.compositeDelta,
    );
  }

  const remaining = new Map(netDelta);
  let total = 0;
  for (const spread of underlying.spreads) {
    if (spread.chargeMethod !== "F" && spread.chargeMethod !== "P") {
      continue;
    }
    if (spread.legs.length < 2) {
      continue;
    }
    const legA =
      spread.legs.find((leg) => leg.side === "A") ?? spread.legs[0];
    const legB =
      spread.legs.find((leg) => leg.side === "B") ?? spread.legs[1];
    const deltaA = remaining.get(legA.expiry) ?? 0;
    const deltaB = remaining.get(legB.expiry) ?? 0;
    if (deltaA === 0 || deltaB === 0) {
      continue;
    }
    if (deltaA > 0 === deltaB > 0) {
      continue;
    }
    const ratioA = legA.ratio || 1;
    const ratioB = legB.ratio || 1;
    const count = Math.min(Math.abs(deltaA) / ratioA, Math.abs(deltaB) / ratioB);
    if (count <= 0) {
      continue;
    }
    total += count * spread.rate;
    remaining.set(
      legA.expiry,
      deltaA - (deltaA > 0 ? 1 : -1) * count * ratioA,
    );
    remaining.set(
      legB.expiry,
      deltaB - (deltaB > 0 ? 1 : -1) * count * ratioB,
    );
  }
  return total;
}

function shortOptionMinimum(
  underlying: SpanUnderlying,
  resolved: Resolved[],
): number {
  if (underlying.somRate <= 0) {
    return 0;
  }
  let shortUnits = 0;
  for (const row of resolved) {
    if (row.contract.instrumentType === "OPT" && row.quantity < 0) {
      shortUnits += Math.abs(row.quantity);
    }
  }
  return underlying.somRate * shortUnits;
}

function netOptionValue(resolved: Resolved[]): number {
  let value = 0;
  for (const row of resolved) {
    if (row.contract.instrumentType === "OPT") {
      value += row.quantity * row.contract.price * row.contract.cvf;
    }
  }
  return value;
}

function exposureFor(
  underlying: SpanUnderlying,
  resolved: Resolved[],
): number {
  let total = 0;
  for (const row of resolved) {
    if (row.contract.instrumentType === "OPT" && row.quantity >= 0) {
      continue;
    }
    const rate = exposureRate(underlying.symbol, row.contract.instrumentType);
    total +=
      rate *
      notionalValue({
        quantity: row.quantity,
        underlyingPrice: underlying.spot || row.contract.price,
        strike: row.contract.strike,
        instrumentType: row.contract.instrumentType,
        cvf: row.contract.cvf,
      });
  }
  return total;
}

function marginForUnderlying(
  underlying: SpanUnderlying,
  resolved: Resolved[],
): MarginBreakdown {
  if (resolved.length === 0) {
    return { span: 0, exposure: 0, total: 0 };
  }
  const { scanRisk: scan } = scanRisk(resolved);
  const calendar = calendarSpreadCharge(underlying, resolved);
  const som = shortOptionMinimum(underlying, resolved);
  const nov = netOptionValue(resolved);
  const risk = Math.max(scan + calendar, som);
  const span = Math.max(0, risk - nov);
  const exposure = exposureFor(underlying, resolved);
  return {
    span,
    exposure,
    total: span + exposure,
  };
}

export function resolvePositions(
  positions: SpanPosition[],
  underlyings: Map<string, SpanUnderlying>,
): { resolved: Map<string, Resolved[]>; missing: string[] } {
  const resolved = new Map<string, Resolved[]>();
  const missing: string[] = [];

  for (const position of positions) {
    const symbol = position.underlying.toUpperCase();
    const underlying = underlyings.get(symbol);
    if (!underlying) {
      missing.push(`${symbol}:underlying`);
      continue;
    }
    const contract = findContract(underlying, position);
    if (!contract) {
      const detail =
        position.instrumentType === "FUT"
          ? `${symbol} FUT ${position.expiryIso}`
          : `${symbol} ${position.optionType} ${position.strike} ${position.expiryIso}`;
      missing.push(detail);
      continue;
    }
    const list = resolved.get(symbol) ?? [];
    list.push({ underlying, contract, quantity: position.quantity });
    resolved.set(symbol, list);
  }

  return { resolved, missing };
}

export function computePortfolioMargin(
  positions: SpanPosition[],
  underlyings: Map<string, SpanUnderlying>,
): MarginBreakdown {
  const { resolved, missing } = resolvePositions(positions, underlyings);
  if (missing.length > 0) {
    throw new SpanError(
      `Unmapped SPAN contracts: ${missing.join("; ")}`,
      422,
      "span_unmapped",
    );
  }

  let span = 0;
  let exposure = 0;
  for (const [symbol, rows] of resolved) {
    const underlying = underlyings.get(symbol);
    if (!underlying) {
      continue;
    }
    const part = marginForUnderlying(underlying, rows);
    span += part.span;
    exposure += part.exposure;
  }
  return { span, exposure, total: span + exposure };
}

export function mergePositions(
  base: SpanPosition[],
  extra: SpanPosition[],
): SpanPosition[] {
  const map = new Map<string, SpanPosition>();
  for (const position of [...base, ...extra]) {
    const key = [
      position.underlying.toUpperCase(),
      position.instrumentType,
      position.optionType ?? "",
      position.expiryIso,
      position.strike ?? "",
    ].join("|");
    const existing = map.get(key);
    if (existing) {
      existing.quantity += position.quantity;
    } else {
      map.set(key, { ...position, underlying: position.underlying.toUpperCase() });
    }
  }
  return [...map.values()].filter((position) => position.quantity !== 0);
}
