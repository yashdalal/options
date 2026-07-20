# Near Expiry Monitor

Local-first Next.js dashboard that monitors open NSE option positions from a Kotak Neo account and highlights contracts trading near their strikes.

## What it does

- Assisted Kotak login: TOTP in the browser; API token, mobile, UCC, and MPIN stay in `.env.local`
- Reads positions from Kotak Neo (read-only usage; no order placement)
- Resolves underlyings via daily scrip master files
- Uses latest completed NSE close (`ohlc.close`) as Spot
- Groups by expiry, pairs calls/puts without collapsing duplicates
- Editable highlight threshold stored in browser local storage
- Manual refresh plus optional 60-second auto refresh

## Prerequisites

- Node.js 20+
- A Kotak Neo Trade API access token
- Registered TOTP authenticator
- UCC / client code
- 6-digit MPIN

## Setup

```bash
cp .env.example .env.local
# edit .env.local with your Kotak credentials
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and enter the current TOTP.

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
npm run probe:kotak
# or
npm run probe:kotak -- --totp=123456
```

The probe authenticates, fetches positions/scrip master/quotes, writes a sanitized summary under `.cache/probe/`, and logs out.

See [docs/kotak-contract.md](docs/kotak-contract.md) for endpoint notes and open questions.

## Security notes

- Never commit `.env.local`
- The browser never receives Kotak tokens, MPIN, SID, or base URL
- Kotak sessions returned after MPIN validation are trading-capable; this app intentionally exposes no trading endpoints
- Bind locally by default; if you later host this, put it behind TLS and your own login

## Project layout

- `src/domain` — pure normalization, pairing, proximity math
- `src/server/kotak` — broker adapters
- `src/server/session.ts` — in-memory single-account session
- `src/server/monitor.ts` — snapshot orchestration with request dedupe
- `src/app/api` — same-origin auth/monitor routes
- `tests/fixtures/kotak` — sanitized fixtures

## Future hosting

Prefer a persistent Node process / small VPS over serverless so the in-memory session and scrip-master cache remain simple. Keep REST polling as the correctness baseline before adding WebSockets.
