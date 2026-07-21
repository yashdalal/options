# Near Expiry Monitor

Local-first Next.js dashboard that monitors open NSE option positions from three linked Kotak Neo accounts (Prakash, Gopa, and HUF) and highlights contracts trading near their strikes.

## What it does

- Assisted Kotak login: connect Prakash, Gopa, and HUF one at a time with separate TOTPs; API tokens, mobiles, UCCs, and MPINs stay in `.env.local`
- Combines positions from all three accounts into one report, tagged by account
- Reads positions from Kotak Neo (read-only usage; no order placement)
- Resolves underlyings via daily scrip master files
- Uses NSE `ltp` as Spot (today's session price / close after hours; not previous-day `ohlc.close`)
- Groups by expiry and company; combines same-strike calls/puts across accounts into one row (expand for per-account legs)
- Editable highlight threshold stored in browser local storage
- Manual refresh plus optional 60-second auto refresh

## Prerequisites

- Node.js 20+
- Kotak Neo Trade API access tokens for Prakash, Gopa, and HUF
- Registered TOTP authenticator for each account
- UCC / client code for each account
- 6-digit MPIN for each account

## Setup

```bash
cp .env.example .env.local
# edit .env.local with KOTAK_PRAKASH_*, KOTAK_GOPA_*, and KOTAK_HUF_* credentials
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and connect each account with its own Connect button whenever you have a fresh TOTP. Sessions are saved as you go. The report opens only when all three are connected. If one account later expires, the other sessions are kept and you only reconnect that account.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server |
| `npm run build && npm start` | Production-local run |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright smoke test |
| `npm run probe:kotak` | Live Kotak contract probe |

### Live probe

```bash
npm run probe:kotak -- --account=prakash
# or
npm run probe:kotak -- --account=gopa --totp=123456
```

The probe authenticates one account, fetches positions/scrip master/quotes, writes a sanitized summary under `.cache/probe/`, and logs out.

See [docs/kotak-contract.md](docs/kotak-contract.md) for endpoint notes and open questions.

## Security notes

- Never commit `.env.local`
- The browser never receives Kotak tokens, MPIN, SID, or base URL
- Kotak sessions returned after MPIN validation are trading-capable; this app intentionally exposes no trading endpoints
- Bind locally by default; if you later host this, put it behind TLS and your own login

## Project layout

- `src/config/accounts.ts` — hardcoded account IDs/labels (Prakash, Gopa, HUF)
- `src/domain` — pure normalization, pairing, proximity math
- `src/server/kotak` — broker adapters
- `src/server/session.ts` — in-memory aggregate session with one broker session per account
- `src/server/monitor.ts` — multi-account snapshot orchestration with request dedupe
- `src/app/api` — same-origin auth/monitor routes
- `tests/fixtures/kotak` — sanitized fixtures

## Future hosting

Prefer a persistent Node process / small VPS over serverless so the in-memory multi-account session and scrip-master cache remain simple. Keep REST polling as the correctness baseline before adding WebSockets.
