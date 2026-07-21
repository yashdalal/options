# Kotak Neo API contract notes

Captured from official documentation and sanitized fixtures.
Live probe (`npm run probe:kotak -- --account=prakash`) should be run with real credentials to confirm production field names and rate limits.

## Multi-account usage

This app links three separate Kotak Neo logins (Prakash, Gopa, HUF). Each account has its own env-prefixed credentials:

- `KOTAK_PRAKASH_*`
- `KOTAK_GOPA_*`
- `KOTAK_HUF_*`

Each set includes access token, mobile number, UCC, and MPIN. Labels are hardcoded in `src/config/accounts.ts`.

Each account is connected separately with its own TOTP and Connect action. Successful account sessions are retained while other accounts remain disconnected. The monitor report is available only when all three broker sessions are connected. If one later expires, the report is gated again and only that account needs a fresh TOTP.

Positions are tagged with `accountId` / `accountLabel` for attribution. Within each expiry, positions are paired by company: same-strike calls/puts are combined across accounts on the summary row, with per-account legs available when expanded.

## Authentication

1. `POST https://mis.kotaksecurities.com/login/1.0/tradeApiLogin`
   - Headers: `Authorization: <access token>`, `neo-fin-key: neotradeapi`
   - Body: `{ mobileNumber, ucc, totp }`
   - Returns view `token` + `sid`

2. `POST https://mis.kotaksecurities.com/login/1.0/tradeApiValidate`
   - Headers: `Authorization`, `neo-fin-key`, `sid`, `Auth`
   - Body: `{ mpin }`
   - Returns trade `token`, `sid`, and dynamic HTTPS `baseUrl`

## Portfolio / market data

| Capability | Path | Auth headers |
|---|---|---|
| Positions | `{baseUrl}/quick/user/positions` | `Auth`, `Sid`, `neo-fin-key` (no Authorization) |
| Quotes | `{baseUrl}/script-details/1.0/quotes/` | `Authorization: <access token>` |
| Scrip master | `{baseUrl}/script-details/1.0/masterscrip/file-paths` | `Authorization: <access token>` |

## Spot price

Use full quotes (not `/ohlc`). Prefer `ltp` / `last_traded_price` for Spot.
`ohlc.close` is previous-day close and is only a fallback.

## Positions quantity

Prefer:

```
netQty = ((cfBuyQty + flBuyQty) - (cfSellQty + flSellQty)) / lotSz
```

Ignore cash-market rows (`exSeg !== nse_fo`) and zero-net option rows.

Kotak may return `stat: Not_Ok`, `stCode: 5203`, `errMsg: "No Data"` when an account has no open positions. Treat that as an empty book, not a hard failure.

## Open questions for live validation

- Exact quote request encoding (query vs body) in current production
- Quote batch-size / rate limits
- Session lifetime and idle timeout
- Whether option `optTp` arrives as `CE`/`PE` or `CALL`/`PUT`
- Token stability across scrip-master regenerations
- Whether positions payloads include a usable account id field (`actId`) in addition to our local tagging

## Fixture source

`tests/fixtures/kotak/*` are sanitized synthetic responses shaped like documented samples.
They intentionally include:

- paired call/put
- unequal call/put counts
- decimal strike (`M&M`)
- cash row to ignore
- zero-net option row to ignore
- missing quote symbol (`M&M` has no quote fixture)
