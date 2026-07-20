# Kotak Neo API contract notes

Captured from official documentation and sanitized fixtures.
Live probe (`npm run probe:kotak`) should be run with real credentials to confirm production field names and rate limits.

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

Use OHLC `close` as previous/latest completed close.

## Positions quantity

Prefer:

```
netQty = ((cfBuyQty + flBuyQty) - (cfSellQty + flSellQty)) / lotSz
```

Ignore cash-market rows (`exSeg !== nse_fo`) and zero-net option rows.

## Open questions for live validation

- Exact quote request encoding (query vs body) in current production
- Quote batch-size / rate limits
- Session lifetime and idle timeout
- Whether option `optTp` arrives as `CE`/`PE` or `CALL`/`PUT`
- Token stability across scrip-master regenerations

## Fixture source

`tests/fixtures/kotak/*` are sanitized synthetic responses shaped like documented samples.
They intentionally include:

- paired call/put
- unequal call/put counts
- decimal strike (`M&M`)
- cash row to ignore
- zero-net option row to ignore
- missing quote symbol (`M&M` has no quote fixture)
