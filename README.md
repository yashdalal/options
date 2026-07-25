# Near Expiry Monitor

Local-first Next.js dashboard for NSE option writing across three linked Kotak Neo accounts (Prakash, Gopa, HUF). It watches open positions drifting toward their strikes, and screens fresh short CE/PE candidates with margin and annualized return.

Read-only against the broker: the app fetches positions, quotes, scrip master, and margin estimates. It exposes no order-placement endpoints.

## Features

### Near Expiry tab

- Combines open positions from all three accounts into one report, tagged by account
- Resolves underlyings, strikes, expiries, and lot sizes from Kotak's daily scrip master
- Groups by expiry and company; same-strike calls/puts across accounts merge into one row (expand for per-account legs)
- Spot comes from the Kotak quote `ltp` — today's session price, or the day's close after hours
- Editable highlight threshold (% distance from strike) plus a "show near only" filter, both persisted in browser local storage
- Manual refresh plus 60-second auto refresh (on by default, toggleable, paused while the tab is hidden). A failed refresh keeps the last snapshot but flags it as stale

### Options Screener tab

- Pick F&O companies and an expiry, then filter short CE/PE by minimum OTM spread and minimum annualized return
- Walks the bid depth to allocate the requested lots, so multi-lot fills price realistically instead of assuming best bid for everything
- Deducts Kotak sell charges before computing return
- Per-row Kotak `check-margin` for annualized return on margin blocked
- 1M / 3M / 1Y price range bars from Yahoo Finance
- Warns when the company has an upcoming board meeting (scraped from the NSE corporate event calendar)
- Reports screening coverage: how many strikes were in band, quoted, skipped for no bid, or below the spread floor

### Basket margin

Add screener rows to a tray and compute NSE SPAN + ELM for the whole multi-leg book, optionally as incremental ΔM against one Kotak account's existing positions. SPAN parameter files are downloaded from NSE archives and cached. See [docs/span-margin.md](docs/span-margin.md).

## Prerequisites

- Node.js 20+ (not enforced via `engines`; Next.js 16 and React 19 need a current LTS)
- Kotak Neo Trade API access token for each of the three accounts
- Registered TOTP authenticator, UCC / client code, and 6-digit MPIN per account

## Setup

```bash
cp .env.example .env.local
# fill in KOTAK_PRAKASH_*, KOTAK_GOPA_*, KOTAK_HUF_*
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and connect each account with its own Connect button as you generate a fresh TOTP. Sessions are saved as you go and last 12 hours. The report opens only once all three accounts are connected; if one later expires, the other two are kept and you reconnect just that account.

## Configuration

| Variable | Purpose |
|---|---|
| `KOTAK_<ACCOUNT>_ACCESS_TOKEN` | Kotak "API Access Token" / "Consumer Key" — plain token, no `Bearer` prefix. `KOTAK_<ACCOUNT>_CONSUMER_KEY` works as an alias |
| `KOTAK_<ACCOUNT>_MOBILE_NUMBER` | Login mobile, `+91` prefixed |
| `KOTAK_<ACCOUNT>_UCC` | Client code |
| `KOTAK_<ACCOUNT>_MPIN` | 6-digit MPIN |
| `KOTAK_LOGIN_BASE_URL` | Optional login host override |
| `KOTAK_NEO_FIN_KEY` | Optional Neo fin key override |
| `HIGHLIGHT_DEFAULT` | Default highlight threshold in % |
| `SESSION_COOKIE_NAME` | Session cookie name |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Session and SPAN cache store. `KV_REST_API_URL` / `KV_REST_API_TOKEN` also accepted |

`<ACCOUNT>` is `PRAKASH`, `GOPA`, or `HUF`.

Without Redis credentials the session store falls back to in-process memory, which is fine for a single local `next dev` process. On Vercel, missing Redis is a hard error rather than a silent fallback, since serverless instances cannot share memory.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server |
| `npm run build && npm start` | Production-local run |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests (Vitest) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:e2e` | Playwright smoke test |
| `npm run probe:kotak` | Live Kotak contract probe |
| `npm run probe:session-store` | Live Upstash Redis session roundtrip |
| `npm run probe:span` | Download/cache NSE SPAN zip and price a sample straddle |

### Live Kotak probe

```bash
npm run probe:kotak -- --account=prakash
# or pass the TOTP inline
npm run probe:kotak -- --account=gopa --totp=123456
```

Authenticates one account, fetches positions / scrip master / quotes, writes a sanitized summary under `.cache/probe/`, and logs out. Without `--totp` it falls back to `KOTAK_TOTP`, then prompts on stdin.

See [docs/kotak-contract.md](docs/kotak-contract.md) for endpoint notes and open questions.

### Local Redis session testing

To exercise the same Redis path production uses:

1. Put Upstash credentials in `.env.local` (from the Vercel/Upstash dashboard, or `vercel env pull .env.local`)
2. Run `npm run probe:session-store` — should print write/read/delete OK
3. Run `npm run dev`, log in with TOTPs, and confirm the server log shows `Using Upstash Redis for trade session store`

## API routes

All routes are same-origin. Everything except `/api/auth/login` and `/api/auth/status` needs a live session, and the monitor, screener, and margin routes need all three accounts connected.

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/login` | POST | Connect one or more accounts with per-account TOTPs; sets the 12h session cookie |
| `/api/auth/logout` | POST | Clear the aggregate session and cookie |
| `/api/auth/status` | GET | Auth state, per-account connection status, default highlight threshold, whether env is configured |
| `/api/monitor` | GET | Near-expiry snapshot across all three accounts |
| `/api/screen` | GET | Screener snapshot for one company + expiry |
| `/api/screen/meta` | GET | F&O underlyings, expiries, and company names from the scrip master |
| `/api/screen/margin` | POST | Kotak `check-margin` for up to 40 legs |
| `/api/margin/basket` | POST | SPAN + ELM for up to 20 basket legs, optional incremental ΔM |
| `/api/margin/span-refresh` | POST | Force re-download and re-parse of the NSE SPAN file |

## Data sources and caching

Caches exist for latency only. Nothing is served past its TTL, and a failed fetch surfaces an error rather than stale numbers.

| Source | Used for | Cache |
|---|---|---|
| Kotak Neo | Positions, quotes, margins | Rate limited to ~8 req/s; in-flight monitor requests deduped |
| Kotak scrip master | Instrument resolution | Daily files under `.cache/scrip-master/` locally (tmpdir on Vercel) plus a parsed in-memory registry |
| NSE archives | SPAN risk parameter files | Parsed snapshot in Redis (48h) or memory |
| Yahoo Finance | 1M / 3M / 1Y price ranges | 4h in memory, per symbol |
| NSE corporate events | Board meeting dates | 4h in memory, with in-flight dedupe |

Independent features stay isolated: option screening still works when Yahoo ranges or the board-meeting calendar fail, and those failures show as errors on the affected rows.

## Security notes

- Never commit `.env.local`
- The browser never receives Kotak tokens, MPIN, SID, or base URL
- Kotak sessions returned after MPIN validation are trading-capable; this app intentionally exposes no trading endpoints
- Binds to localhost by default; if you host it, put it behind TLS and your own login

## Project layout

```
src/config/accounts.ts        hardcoded account ids/labels (Prakash, Gopa, HUF)
src/config/env.ts             env parsing and per-account credential assembly
src/domain/                   pure logic: normalization, pairing, proximity, screening math
src/lib/                      client helpers: formatting, screener settings, report runner
src/hooks/                    screener settings hook (local storage backed)
src/components/               app shell, login form, monitor dashboard, screener, basket tray
src/app/api/                  same-origin auth / monitor / screen / margin routes
src/server/session.ts         aggregate session holding one broker session per account
src/server/session-store.ts   Upstash Redis persistence, in-memory fallback for local dev
src/server/monitor.ts         multi-account snapshot orchestration with request dedupe
src/server/screen.ts          screener orchestration across scrip master, quotes, margins
src/server/kotak/             broker adapters (auth, quotes, positions, margin, scrip master)
src/server/market-data/       Yahoo history, NSE board meetings
src/server/span/              SPAN download, parse, engine, store, exposure rates
tests/fixtures/               sanitized Kotak fixtures and a trimmed SPAN file
```

## Testing

Vitest covers `tests/**/*.test.ts` in a Node environment — domain math, SPAN engine and URL construction, session and session-store behavior, market-data adapters, and report filtering. Playwright runs one Chrome smoke spec against `127.0.0.1:3000`, starting the dev server if it is not already up.

## Known gaps

- Spot resolution falls back to `ohlc.close` when a quote has no `ltp` or `last_traded_price` (`src/server/kotak/quotes.ts`). That substitutes a previous-session price for a live one, which conflicts with the fail-visibly policy in `AGENTS.md`.
- `@testing-library/react` and `jsdom` are installed but the Vitest environment is `node`, so no component tests run today.

## Hosting

On Vercel, connect **Upstash Redis** so login sessions and the SPAN snapshot are shared across serverless instances. Keep REST polling as the correctness baseline before considering WebSockets.
