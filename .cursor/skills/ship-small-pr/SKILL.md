---
name: ship-small-pr
description: Splits work into small, independently verified PRs for the options tracker and practically tests each one (app still loads in demo mode, changed behavior exercised in the UI, live Kotak checks when demo cannot cover it) before opening it. Use whenever creating a change, branch, commit set, or pull request in this repo, or when the user asks to split, ship, or open a PR.
---

# Ship small, verified PRs

Every change in this repo ships as a small PR that has been practically tested. "Tests pass" is not enough on its own: someone has to load the app and see that it works.

## 1. Split the work

- One concern per PR: a bug fix, a feature, a tooling change, or a docs change. Never mix a fix with unrelated refactors.
- Aim for a diff under ~300 lines, not counting tests, fixtures, and evidence images.
- Each PR must leave `main` working if it's merged alone. If B needs A, stack B on A's branch and set B's PR base to A's branch.
- Name branches `fix/…`, `feat/…`, or `chore/…`.

## 2. Verify each PR before opening it

Copy this checklist into your working notes and complete it for each branch:

```
- [ ] npm run verify            (typecheck, unit tests, lint, build)
- [ ] npm run test:e2e:demo     (app loads; Near Expiry and Screener work in demo mode)
- [ ] Exercised the actual change (see the table below) and wrote down what I saw
- [ ] UI change: before/after screenshots in docs/pr-evidence/<slug>/{before,after}/
- [ ] Live-only behavior: marked "Needs live verification" and listed the exact steps
```

| Change type | Practical test |
|---|---|
| UI or copy | Run `npm run dev` with `DEMO_MODE=1`, click through the changed view, and capture before/after (see `.cursor/rules/ui-evidence-screenshots.mdc`) |
| Server logic that demo data covers | Call the route or click the flow in demo mode and confirm the output |
| Error paths | Force the failure in demo mode (for example `DEMO_FAIL_OPTION_QUOTES=<SYMBOL>` once it exists) and confirm the UI shows it |
| Kotak behavior demo can't reproduce (quotes, margins, limits, auth) | Run the demo checks above, then verify live with `npm run probe:kotak` during Indian market hours (9:15–15:30 IST) using TOTPs from the user. Don't merge before that |
| Scripts or tooling | Run the script yourself and paste the relevant output |
| Docs only | No runtime test needed; say so |

If a check fails, fix it or report it. Never open a PR while hiding a failed or skipped check.

## 3. PR description

```markdown
## Summary
- What changed and why (1–3 bullets)

## How I tested it
- `npm run verify` — pass
- `npm run test:e2e:demo` — pass
- <exact manual steps and what I observed>

## Evidence
<before/after images, or "not a UI change">

## Needs live verification
<steps for a live Kotak session, or "none">
```

## 4. Push and merge

- Push and open the PR only after the checklist is done. Use a draft PR while anything is still marked "Needs live verification".
- Merge stacked PRs bottom-up, and rebase the next one after each merge.
