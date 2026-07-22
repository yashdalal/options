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
| Quotes | `{baseUrl}/script-details/1.0/quotes/neosymbol/{seg\|token[,…]}` | `Authorization: <access token>` |
| Scrip master | `{baseUrl}/script-details/1.0/masterscrip/file-paths` | `Authorization: <access token>` |
| Check margin | `{baseUrl}/quick/user/check-margin` | `Auth`, `Sid`, `neo-fin-key` (no Authorization) |

Official Postman also shows quotes with a trailing `/{quote_type}` (for example `/all`). This app uses the path without `quote_type`, which already works for cash spots; FO option LTP uses the same helper. If a live probe ever returns empty FO quotes, try appending `/all` or `/ltp`.

## Spot price

Use full quotes (not `/ohlc`). Prefer `ltp` / `last_traded_price` for Spot.
`ohlc.close` is previous-day close and is only a fallback.

## Option premiums

There is no dedicated option-chain endpoint. Build the chain from the daily `nse_fo` scrip master (`OPTSTK` rows with strike, expiry, lot size, CE/PE), then quote `nse_fo|{instrumentToken}`.

For sell-side screener premium, walk `depth.buy` levels with price > 0. Available lots at a level are `floor(quantity / lotSize)` (not the ORDERS count). When requested lots exceed liquidity at the best bid, the screener emits one candidate row per fill price. Fall back to `buy_price` as a single fill only when depth has no usable quantity. Do not use LTP for executable sell premium — deep OTM options often show a stale tick with an empty buy book.

## Check margin (sell options)

`POST {baseUrl}/quick/user/check-margin` with `Content-Type: application/x-www-form-urlencoded` and body field:

```
jData={"brkName":"KOTAK","brnchId":"ONLINE","exSeg":"nse_fo","prc":"<premium>","prcTp":"L","prod":"NRML","qty":"<lotSize*lots>","tok":"<instrumentToken>","trnsTp":"S"}
```

Prefer response `ordMrgn` as incremental margin for the checked order (fallbacks: `reqdMrgn`, then `totMrgnUsd` / `mrgnUsd`). `totMrgnUsd` is account-level total including existing positions, so it is too high for screener return math. One instrument per request. Expect `429` under load; the app shares an ~8 req/s limiter across quotes and margin.

## Positions quantity

Prefer:

```
netQty = ((cfBuyQty + flBuyQty) - (cfSellQty + flSellQty)) / lotSz
```

Ignore cash-market rows (`exSeg !== nse_fo`) and zero-net option rows.

Kotak may return `stat: Not_Ok`, `stCode: 5203`, `errMsg: "No Data"` when an account has no open positions. Treat that as an empty book, not a hard failure.

## Open questions for live validation

- Exact quote request encoding (query vs body) in current production
- Whether FO quotes need the trailing `/{quote_type}` path segment
- Quote batch-size / rate limits (published order limit is 10/sec; check-margin returns 429)
- Session lifetime and idle timeout
- Whether option `optTp` arrives as `CE`/`PE` or `CALL`/`PUT`
- Token stability across scrip-master regenerations
- Whether positions payloads include a usable account id field (`actId`) in addition to our local tagging
- Whether `ordMrgn` is always populated for short option NRML checks

## Fixture source

`tests/fixtures/kotak/*` are sanitized synthetic responses shaped like documented samples.
They intentionally include:

- paired call/put
- unequal call/put counts
- decimal strike (`M&M`)
- cash row to ignore
- zero-net option row to ignore
- missing quote symbol (`M&M` has no quote fixture)
