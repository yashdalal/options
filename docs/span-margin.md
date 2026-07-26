# NSE SPAN basket margin

Portfolio-aware F&O margin for multi-leg baskets using NSE Clearing SPAN risk-parameter files plus (optional) one Kotak account’s open positions.

## What it computes

- **Basket alone** — SPAN + extreme-loss margin (ELM) for the proposed legs on an empty book
- **With `accountId`** — `M0` (current book), `M1` (book + basket), **`ΔM = M1 − M0`** (incremental)

SPAN is portfolio-level: a short straddle/strangle is one combined book, so put/call offsets apply. Summing two single-leg Kotak `check-margin` calls does not.

## File source

| Item | Source |
|---|---|
| SPAN zip | `https://nsearchives.nseindia.com/archives/nsccl/span/nsccl.YYYYMMDD.{i1..i5\|s}.zip` |
| Freshness | Newest available snapshot for the latest trading session (`i5`→`i1`, then `s`) |
| ELM rates | Documented NSE defaults (index **2%**, stock **3.5%** of notional). Per-security `ael_*.csv` is member-FTP only and not used. Responses label `exposureSource: "nse_default_rates"`. |

Probe: `npm run probe:span`  
Warm cache: `POST /api/margin/span-refresh` (requires Kotak login)  
Calculate: `POST /api/margin/basket`

Parsed underlyings are cached in Upstash Redis (in-process memory when Redis is unset). Raw zips stay in `/tmp` only during parse.

## API shape

```json
{
  "accountId": "prakash",
  "legs": [
    {
      "exchangeSegment": "nse_fo",
      "underlying": "RELIANCE",
      "expiryIso": "2026-07-28",
      "strike": 1400,
      "optionType": "CALL",
      "side": "SELL",
      "lots": 1,
      "lotSize": 250
    }
  ]
}
```

Omit `accountId` for empty-book basket margin only.

## Caveats

- Exchange-style estimate — Kotak may add broker buffers
- **Delivery margins near expiry are not modeled.** Stock legs/positions within ~5 calendar days of expiry set `deliveryMarginWarning`
- NSE F&O only (`nse_fo`). BSE legs/positions fail visibly
- Unmapped contracts fail visibly — never dropped silently
- Failed SPAN fetch never serves a stale snapshot as recovery

## UI

Options Screener tab:

- Candidate **Margin** cells show Kotak check-margin (used for ann. return) with a muted single-leg SPAN + ELM estimate underneath (same engine as baskets) and a Δ% vs Kotak. If Kotak check-margin fails, SPAN is used for ann. return instead; Kotak shows as —, SPAN stays muted with `(est.)`, and the return cell shows a warning icon with a hover tip that the math is local SPAN, not Kotak’s API
- **+ Basket** on candidate rows opens the sticky basket tray with account picker, portfolio ΔM, and return-on-ΔM when all legs share one expiry
