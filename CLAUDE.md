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

- Booking window is **uncertain since 2026-08** (was D−6 at 07:00 ICT; evidence now points to D−5): the bot races every candidate in `config.json` → `advanceDaysCandidates` (default `[5, 6]`) whose weekday is in `schedule`. Hence launchd runs Sun+Mon+Tue.
- Each target date has a **window gate**: `executeRace` polls read-only `listCourts` until the date returns court rows before firing any `CreateOrEdit` (issue #5: firing at an unopened date burned quota and tripped the rate limiter).
- The API **rate-limits `CreateOrEdit`** ("จองถี่เกินไป / Booking too frequent"). `RequestPacer` enforces `race.accountIntervalMs` per account + `race.ipIntervalMs` across accounts; a rate-limit error adds `race.rateLimitBackoffMs` penalty. Don't make the bot hammer again.
- 1 account = 1 hour/day max → a 2-hour block requires 2 accounts (`config.json` accounts + `TU_A_`/`TU_B_` env prefixes).
- Court number → API court id: 01→39, 02→40, 03→41, 04→51, 05→52 (map in `core/types.ts`). A court answering "ปิดทำการ" while the window is open is dropped from that task's rotation.
- Race timing (`config.json` → `race`): `fireAt: 07:00:00`, gate + paced retries until `deadline: 07:05:00`.

## Deployment / ops

Production = launchd on Mac mini: `com.botbookyoucourt.race` (Sun,Mon,Tue 06:55) + `com.botbookyoucourt.fallback` (Sun,Mon,Tue 07:10). Bootstrap with `zsh scripts/setup-macmini.sh`. Verify with `zsh scripts/test-schedule.sh` (safe dry-run) or `--live` (kickstarts fallback agent). `scripts/run.sh` pings healthchecks.io (dead-man switch). Full runbook: `docs/DEPLOYMENT.md`.

## Notes

- `bookyourcourt.psm.tu.ac.th.har` at repo root is a 9.5 MB captured HAR of the real site — reference for API request/response shapes; don't read it whole, grep it.
- Logs land in `logs/YYYY-MM-DD.log`; booking state in `state/booked-<date>.json`.
