# botbookyoucourt

Bot จองสนามเทนนิส TU (bookyourcourt.psm.tu.ac.th) อัตโนมัติ — pure HTTP, ไม่ใช้ browser

## กติการะบบจอง

- จองล่วงหน้าได้ 7 วัน, slot วันใหม่เปิดทุกวัน 07:00 ICT
- 1 user จองได้ 1 ชั่วโมง/วัน → 2 ชม.ติดต้องใช้ 2 accounts
- court map: 01→39, 02→40, 03→41, 04→51, 05→52

## Setup

```sh
bun install
cp .env.example .env   # กรอก credentials + telegram token
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

## ติดตั้ง scheduler (launchd, รันทุกวัน 06:55)

```sh
./scripts/install-launchd.sh
```

Script gen plist จาก path ปัจจุบัน แล้ว load ให้เลย — ย้าย repo ไป path อื่นก็รันซ้ำได้.

เครื่องต้องตื่นตอน 06:55 — ตั้ง wake schedule:

```sh
sudo pmset repeat wakeorpoweron MTWRFSU 06:53:00
```

bot จะ exit เองถ้าวันเป้าหมาย (วันนี้+7) ไม่อยู่ใน config

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
    PORTS["ports.ts<br/>BookingGateway · Notifier"]
    TY[types.ts]
    ICT[ict.ts]
  end
  subgraph adapters["adapters/ (I/O)"]
    BYC["bookyourcourt.ts<br/>implements BookingGateway"]
    TG["telegram.ts<br/>implements Notifier"]
    LOG[logger.ts]
  end

  CLI --> EX & CFG & PL & BYC & TG
  EX --> PORTS & TY & ICT
  PL --> TY & ICT
  BYC -.implements.-> PORTS
  TG -.implements.-> PORTS
  EX --> LOG
```

Flow การจอง:

```mermaid
sequenceDiagram
  participant L as launchd (06:55)
  participant C as cli/main
  participant P as planner (core)
  participant E as executor (app)
  participant G as BookingGateway (adapter)
  L->>C: run
  C->>P: buildPlan(config, วันนี้+7)
  P-->>C: BookingTask[]
  C->>G: authenticate() ทุก account
  C->>C: รอถึง fireAt (07:00)
  C->>E: executePlan(tasks, deadline)
  loop จนจองได้ / ถึง deadline
    E->>G: createBooking(court)
    G-->>E: bookingId / error
  end
  E-->>C: TaskResult[]
  C->>C: notify Telegram + log
```
