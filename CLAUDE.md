# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bot that auto-books TU tennis courts (bookyourcourt.psm.tu.ac.th) via pure HTTP (no browser). Runs on a Mac mini in Thailand via launchd — the TU API geo-blocks non-Thai IPs, so live API calls only work from a Thai IP.

## Commands

Runtime is **bun** (not node/npm).

```sh
bun run typecheck          # tsc --noEmit (strict)
bun run lint               # biome check src
bun test                   # all tests
bun test src/core/planner.test.ts   # single test file
bun test -t "name"         # single test by name
bun run format             # biome format --write src
```

Run all three (typecheck + lint + test) before opening a PR — CI runs the same set.

App commands (see README for full list):

```sh
bun run dry-run            # login + show plan + free-slot table, no real booking
bun run status             # today's slot table
bun run run:now            # book immediately (60s deadline)
bun run run:scheduled      # real mode: wait for race.fireAt, then fire until deadline
```

## Architecture

Hexagonal-lite. Dependency flows one way: `cli → app → core`; adapters implement ports defined in core.

- `src/core/` — pure logic, **no I/O allowed** (never import from `adapters/` or `app/`):
  - `planner.ts` — `buildPlan`: config + date → `BookingTask[]`
  - `marker.ts` — `pendingTasks` / `mergeMarks`: idempotent re-run support (skip already-booked tasks)
  - `ports.ts` — `BookingGateway`, `Notifier`, `BookingStore` interfaces
  - `ict.ts` — all date/time math in ICT (UTC+7); dates are `IctDate` records, not raw `Date`
- `src/adapters/` — port implementations: `bookyourcourt.ts` (HTTP), `telegram.ts`, `booking-store.ts` (`state/booked-<date>.json`), `logger.ts`
- `src/app/` — orchestration: `executor.ts` (race loop: fire bookings until success or deadline), `config.ts` (loads `config.json` + `.env`)
- `src/cli/main.ts` — composition root: arg parsing, wires adapters into app/core

To add a new external (e.g. another notifier): define/use a port in `core/ports.ts`, implement it in `adapters/`, wire in `cli/main.ts`, test with a fake implementing the same port (pattern in `src/app/executor.test.ts`).

## Testing conventions

Tests colocate as `*.test.ts` next to source. Focus on `core/` (pure, deterministic) and `executor` (fake ports instead of real HTTP). Thin HTTP-wrapper adapters are intentionally untested.

## Domain rules (drive most logic)

- Booking opens **6 days ahead**: slots for day D open at 07:00 ICT on D−6. `buildPlan` defaults `advanceDays=6`; the bot exits if today+6 isn't in `config.json`'s schedule. Hence launchd runs Sun+Mon (books Sat+Sun courts).
- 1 account = 1 hour/day max → a 2-hour block requires 2 accounts (`config.json` accounts + `TU_A_`/`TU_B_` env prefixes).
- Court number → API court id: 01→39, 02→40, 03→41, 04→51, 05→52 (map in `core/types.ts`).
- Race timing (`config.json` → `race`): fire slightly before 07:00 (`fireAt: 06:59:58`), retry until `deadline`.

## Deployment / ops

Production = launchd on Mac mini: `com.botbookyoucourt.race` (Sun,Mon 06:55) + `com.botbookyoucourt.fallback` (Sun,Mon 07:10). Bootstrap with `zsh scripts/setup-macmini.sh`. Verify with `zsh scripts/test-schedule.sh` (safe dry-run) or `--live` (kickstarts fallback agent). `scripts/run.sh` pings healthchecks.io (dead-man switch). Full runbook: `docs/DEPLOYMENT.md`.

## Notes

- `bookyourcourt.psm.tu.ac.th.har` at repo root is a 9.5 MB captured HAR of the real site — reference for API request/response shapes; don't read it whole, grep it.
- Logs land in `logs/YYYY-MM-DD.log`; booking state in `state/booked-<date>.json`.
