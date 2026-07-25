import type { AccountId } from "@/config/accounts";
import type { TradeSessionCredentials } from "../kotak/auth";
import {
  computePortfolioMargin,
  mergePositions,
} from "./engine";
import { SpanError, isSpanError } from "./errors";
import { EXPOSURE_SOURCE } from "./exposure";
import { refreshSpanSnapshot } from "./fetch";
import {
  basketLegsToSpanPositions,
  deliveryMarginWarningFor,
  loadAccountSpanPositions,
  type BasketLegInput,
} from "./positions";
import { readSpanManifest, readSpanUnderlyings } from "./store";
import type { BasketMarginResult, SpanSnapshotMeta } from "./types";

export type SingleLegSpanMarginInput = BasketLegInput & {
  id?: string;
};

export type SingleLegSpanMarginResult = {
  id?: string;
  spanMargin: number | null;
  error?: string;
};

const STALE_MS = 60 * 60 * 1000;

function isManifestFresh(meta: SpanSnapshotMeta): boolean {
  const fetchedAt = Date.parse(meta.fetchedAt);
  if (!Number.isFinite(fetchedAt)) {
    return false;
  }
  return Date.now() - fetchedAt < STALE_MS;
}

export async function ensureSpanSnapshot(options?: {
  force?: boolean;
}): Promise<SpanSnapshotMeta> {
  if (!options?.force) {
    const existing = await readSpanManifest();
    if (existing && isManifestFresh(existing)) {
      return existing;
    }
  }
  return refreshSpanSnapshot({ force: options?.force });
}

export async function calculateBasketMargin(input: {
  legs: BasketLegInput[];
  accountId?: AccountId;
  accountSession?: TradeSessionCredentials;
  requestId: string;
}): Promise<BasketMarginResult> {
  if (input.legs.length < 1 || input.legs.length > 20) {
    throw new SpanError(
      "Basket must contain between 1 and 20 legs",
      400,
      "invalid_basket",
    );
  }

  const basketPositions = basketLegsToSpanPositions(input.legs);
  const symbols = basketPositions.map((position) => position.underlying);

  let accountPositions: Awaited<
    ReturnType<typeof loadAccountSpanPositions>
  > = [];
  if (input.accountId) {
    if (!input.accountSession) {
      throw new SpanError(
        "Kotak session required for account incremental margin",
        401,
        "login_required",
      );
    }
    accountPositions = await loadAccountSpanPositions(
      input.accountSession,
      input.accountId,
      input.requestId,
    );
    for (const position of accountPositions) {
      symbols.push(position.underlying);
    }
  }

  await ensureSpanSnapshot();
  const loaded = await readSpanUnderlyings(symbols);
  if (!loaded) {
    throw new SpanError("SPAN snapshot unavailable", 503, "span_unavailable");
  }

  const basket = computePortfolioMargin(basketPositions, loaded.underlyings);
  let account: BasketMarginResult["account"] = null;

  if (input.accountId) {
    const current = computePortfolioMargin(
      accountPositions,
      loaded.underlyings,
    );
    const after = computePortfolioMargin(
      mergePositions(accountPositions, basketPositions),
      loaded.underlyings,
    );
    account = {
      accountId: input.accountId,
      current,
      after,
      incremental: {
        span: after.span - current.span,
        exposure: after.exposure - current.exposure,
        total: after.total - current.total,
      },
    };
  }

  return {
    spanFile: {
      date: loaded.meta.date,
      variant: loaded.meta.variant,
      exposureSource: EXPOSURE_SOURCE,
    },
    basket,
    account,
    deliveryMarginWarning: deliveryMarginWarningFor([
      ...basketPositions,
      ...accountPositions,
    ]),
  };
}

export async function calculateSingleLegSpanMargins(
  legs: SingleLegSpanMarginInput[],
): Promise<SingleLegSpanMarginResult[]> {
  if (legs.length === 0) {
    return [];
  }

  const prepared = legs.map((leg) => {
    try {
      const [position] = basketLegsToSpanPositions([leg]);
      return { leg, position, error: null as string | null };
    } catch (error) {
      return {
        leg,
        position: null,
        error: error instanceof Error ? error.message : "span_failed",
      };
    }
  });

  const symbols = prepared
    .map((row) => row.position?.underlying)
    .filter((symbol): symbol is string => Boolean(symbol));

  let underlyings: Awaited<ReturnType<typeof readSpanUnderlyings>> = null;
  let snapshotError: string | null = null;
  if (symbols.length > 0) {
    try {
      await ensureSpanSnapshot();
      underlyings = await readSpanUnderlyings(symbols);
      if (!underlyings) {
        snapshotError = "SPAN snapshot unavailable";
      }
    } catch (error) {
      snapshotError = isSpanError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "span_failed";
    }
  }

  return prepared.map(({ leg, position, error }) => {
    if (error || !position) {
      return {
        id: leg.id,
        spanMargin: null,
        error: error ?? "span_failed",
      };
    }
    if (!underlyings) {
      return {
        id: leg.id,
        spanMargin: null,
        error: snapshotError ?? "SPAN snapshot unavailable",
      };
    }
    try {
      const margin = computePortfolioMargin([position], underlyings.underlyings);
      return {
        id: leg.id,
        spanMargin: margin.total,
      };
    } catch (computeError) {
      return {
        id: leg.id,
        spanMargin: null,
        error:
          computeError instanceof Error ? computeError.message : "span_failed",
      };
    }
  });
}
