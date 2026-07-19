# botbookyoucourt

Bot จองสนามเทนนิส TU (bookyourcourt.psm.tu.ac.th) อัตโนมัติ — pure HTTP, ไม่ใช้ browser

## กติการะบบจอง

- จองล่วงหน้าได้ 7 วัน, slot วันใหม่เปิดทุกวัน 07:00 ICT
- 1 user จองได้ 1 ชั่วโมง/วัน → 2 ชม.ติดต้องใช้ 2 accounts
- court map: 01→39, 02→40, 03→41, 04→51, 05→52

## Setup

```sh
npm install
cp .env.example .env   # กรอก credentials + telegram token
```

`config.json` — วัน/เวลา/ลำดับ court ที่ต้องการ, เวลายิง (`race.fireAt`)

## คำสั่ง

```sh
npm run dry-run              # login + แสดง plan + ตาราง slot ว่าง (ไม่จองจริง)
npm run status               # ตาราง slot วันนี้
npm run status -- --date 2026-07-26
npm run run:now              # จองทันที ไม่รอ 07:00 (deadline 60s)
npm run run:scheduled        # โหมดจริง: รอถึง fireAt แล้วยิงจนถึง deadline
npx tsx src/main.ts book --date 2026-07-22 --hour 10 --court 3   # จอง manual 1 slot
npm run cancel -- --account aof --code A0KK429
```

## ติดตั้ง scheduler (launchd, รันทุกวัน 06:55)

```sh
cp launchd/com.aof.bookyourcourt.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.aof.bookyourcourt.plist
```

เครื่องต้องตื่นตอน 06:55 — ตั้ง wake schedule:

```sh
sudo pmset repeat wakeorpoweron MTWRFSU 06:53:00
```

bot จะ exit เองถ้าวันเป้าหมาย (วันนี้+7) ไม่อยู่ใน config

## Logs

`logs/YYYY-MM-DD.log` + Telegram แจ้งผลทุกครั้ง (สำเร็จ/ล้มเหลว/crash)
