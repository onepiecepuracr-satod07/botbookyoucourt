# Contributing

## Setup

```sh
bun install
cp .env.example .env   # credentials + telegram token
```

## Dev loop

```sh
bun run typecheck   # tsc --noEmit (strict)
bun run lint        # biome check src
bun run format      # biome format --write src
bun test            # unit tests
```

รันครบ 3 (typecheck + lint + test) ก่อนเปิด PR — CI รันชุดเดียวกัน เป็น gate ก่อน merge.

## Architecture

Hexagonal-lite แยกตาม role. dependency ไหลทางเดียว: `cli → app → core`, adapters implement port ที่ core นิยาม.

```
src/
  core/       # pure logic + domain types + port interfaces (ไม่มี I/O — test ง่าย)
    ict.ts        # date/time ICT (+7)
    types.ts      # config schema, court map, pure helpers
    planner.ts    # buildPlan: config + วันที่ → BookingTask[]
    marker.ts     # pendingTasks / mergeMarks (idempotent fallback) + BookingMark schema
    ports.ts      # BookingGateway, Notifier, BookingStore (interface)
    errors.ts     # AbpError
  adapters/   # implement port, คุย external
    bookyourcourt.ts  # BookingGateway ← HTTP client
    telegram.ts       # Notifier ← Telegram API
    booking-store.ts  # BookingStore ← state/booked-<date>.json
    logger.ts         # file + console
  app/        # orchestrate
    config.ts     # loadConfig / loadCredentials (file + env I/O)
    executor.ts   # executePlan: ยิงจอง race จนถึง deadline
  cli/
    main.ts       # arg parse + command handlers (composition root)
  index.ts    # entrypoint
```

**กฎ dependency:** `core/` ห้าม import จาก `adapters/` หรือ `app/`. adapter พึ่ง `core/` ได้. cli ต่อสายทุกอย่างเข้าด้วยกัน.

## เพิ่ม external ใหม่ (เช่น notifier ช่องอื่น)

1. นิยาม / ใช้ port interface ใน `core/ports.ts`
2. เขียน adapter ใน `adapters/` ที่ `implements` port นั้น
3. ต่อสายใน `cli/main.ts`
4. test ด้วย fake ที่ implement port เดียวกัน (ดู `src/app/executor.test.ts`)

## Testing

`bun test` — test colocate เป็น `*.test.ts` ข้างไฟล์จริง. เน้น `core/` (pure, deterministic) + `executor` (ใช้ fake port แทน HTTP จริง). ไม่ test adapter ที่เป็น HTTP wrapper บาง ๆ.
