# botbookyoucourt

Bot จองสนามเทนนิส TU (bookyourcourt.psm.tu.ac.th) อัตโนมัติ — pure HTTP, ไม่ใช้ browser

## กติการะบบจอง

- จองล่วงหน้าได้ 6 วัน (target = today+6), slot วันใหม่เปิดทุกวัน 07:00 ICT
- 1 user จองได้ 1 ชั่วโมง/วัน → 2 ชม.ติดต้องใช้ 2 accounts
- court map: 01→39, 02→40, 03→41, 04→51, 05→52
- ⚠️ TU API บล็อก IP ต่างประเทศ → bot ต้องรันจาก **IP ไทย** เท่านั้น (ดู [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md))

## Setup

```sh
bun install
cp .env.example .env   # กรอก credentials + telegram token + HEALTHCHECK_URL
```

`config.json` — วัน/เวลา/ลำดับ court ที่ต้องการ, เวลายิง (`race.fireAt`)

## คำสั่ง

```sh
bun run dry-run              # login + แสดง plan + ตาราง slot ว่าง (ไม่จองจริง)
bun run status               # ตาราง slot วันนี้
bun run status -- --date 2026-07-26
bun run run:now              # จองทันที ไม่รอ 07:00 (deadline 60s)
bun run run:scheduled        # โหมดจริง: รอถึง fireAt แล้วยิงจนถึง deadline
bun src/index.ts book --date 2026-07-22 --hour 10 --court 3   # จอง manual 1 slot
bun run cancel -- --account aof --code A0KK429
```

## Deployment

รันจริงบน Mac mini บ้าน (Thai IP) ด้วย launchd 2 agents — race (Sun,Mon 06:55) + fallback (Sun,Mon 07:10). setup ครั้งเดียว:

```sh
zsh scripts/setup-macmini.sh   # ลง bun, deps, pmset no-sleep, สร้าง+load launchd, smoke test
```

**Window:** slot เปิด 07:00 ICT สำหรับวัน **+6** → `buildPlan` default `advanceDays=6`. bot exit เองถ้าวันเป้าหมาย (today+6) ไม่อยู่ใน config. จองวันเล่นต้อง run ก่อน 6 วัน → คอร์ท **เสาร์ = run วันอาทิตย์**, คอร์ท **อาทิตย์ = run วันจันทร์** (จึงตั้ง launchd Sun + Mon).

runbook เต็ม (geo-block, healthchecks, troubleshooting, recovery) → [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Logs

`logs/YYYY-MM-DD.log` + Telegram แจ้งผลทุกครั้ง (สำเร็จ/ล้มเหลว/crash)

## Architecture

Hexagonal-lite — แยกตาม role, dependency ไหลทางเดียว `cli → app → core`. รายละเอียด + กฎ dependency ดู [CONTRIBUTING.md](CONTRIBUTING.md).

```mermaid
flowchart TD
  CLI["cli/main.ts<br/>(composition root)"]
  subgraph app["app/ (orchestrate)"]
    EX[executor.ts]
    CFG[config.ts]
  end
  subgraph core["core/ (pure, no I/O)"]
    PL[planner.ts]
    MK["marker.ts<br/>pendingTasks · mergeMarks"]
    PORTS["ports.ts<br/>BookingGateway · Notifier · BookingStore"]
    TY[types.ts]
    ICT[ict.ts]
  end
  subgraph adapters["adapters/ (I/O)"]
    BYC["bookyourcourt.ts<br/>implements BookingGateway"]
    TG["telegram.ts<br/>implements Notifier"]
    BS["booking-store.ts<br/>implements BookingStore"]
    LOG[logger.ts]
  end

  CLI --> EX & CFG & PL & MK & BYC & TG & BS
  EX --> PORTS & TY & ICT
  PL --> TY & ICT
  MK --> TY
  BYC -.implements.-> PORTS
  TG -.implements.-> PORTS
  BS -.implements.-> PORTS
  EX --> LOG
```

Flow การจอง:

```mermaid
sequenceDiagram
  participant L as launchd (Sun+Mon 06:55)
  participant C as cli/main
  participant P as planner (core)
  participant S as BookingStore (adapter)
  participant E as executor (app)
  participant G as BookingGateway (adapter)
  L->>C: run
  C->>P: buildPlan(config, วันนี้+6)
  P-->>C: BookingTask[]
  C->>S: load(targetDate) → marks
  C->>C: pendingTasks = ตัด task ที่จองแล้ว
  C->>G: authenticate() เฉพาะ account ที่ค้าง
  C->>C: รอถึง fireAt (06:59:58)
  C->>E: executePlan(pending, deadline)
  loop จนจองได้ / ถึง deadline
    E->>G: createBooking(court)
    G-->>E: bookingId / error
  end
  E-->>C: TaskResult[]
  C->>S: save(marks + ที่จองสำเร็จ)
  C->>C: notify Telegram + log
```
