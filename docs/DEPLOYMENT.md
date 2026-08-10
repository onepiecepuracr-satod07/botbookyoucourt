# Deployment & Operations

Runbook สำหรับ host bot จริง. อ่านไฟล์นี้แล้วกู้/ย้าย/แก้ระบบได้เอง.

## 1. ทำไมต้อง host ในไทย (geo-block)

TU API `bookyourcourtapi.psm.tu.ac.th` (49.229.83.38) **บล็อก IP ต่างประเทศ** — เชื่อมต่อจาก cloud นอกไทย = connection timeout.

พิสูจน์แล้ว (2026-07-25):

| จาก | ผล |
|---|---|
| Mac ในไทย (residential IP) | ✅ HTTP 302 ใน 0.29s |
| DigitalOcean Singapore VPS | ❌ connection timeout (DNS ได้ IP ไทยแต่ต่อไม่ติด) |

**ผลลัพธ์การตัดสินใจ:** bot ต้องรันจาก **IP ไทยเท่านั้น**. Cloud VPS สิงคโปร์/US/EU ใช้ไม่ได้แม้ latency ต่ำ. เลือก host = **Mac mini M4 ที่บ้าน** (Thai residential IP, desktop เปิด 24/7, กินไฟต่ำ).

ทางเลือกอื่นที่ใช้ได้ (ทั้งหมดต้อง Thai IP): Thai VPS (Netway/Z.com/AWS ap-southeast-7 Bangkok), Raspberry Pi บ้าน, โน้ตบุ๊กเก่าบ้าน.

## 2. สถาปัตยกรรม runtime

รันเป็น 2 launchd agents บน Mac mini:

| agent | เวลา | คำสั่ง | หน้าที่ |
|---|---|---|---|
| `com.botbookyoucourt.race` | Sun,Mon 06:55 | `run` | pre-auth แล้วรอถึง `fireAt` 06:59:58 → ยิง retry ทุก 500ms จนถึง `deadline` 07:02 |
| `com.botbookyoucourt.fallback` | Sun,Mon 07:10 | `run --now` | เก็บตกถ้า race แพ้ (demand ต่ำ คอร์ตมักว่างถึง ~08:24) |

กลไกกันพลาด:
- **Single-instance lock** — `run.sh` จับ `state/.run.lock` (`mkdir` atomic + เช็ค pid stale) ก่อนรัน. ถ้ามี instance อื่นถืออยู่ → `exit 0` เงียบ (ไม่ ping healthcheck fail). กันเคส 2 process ยิงชนกัน (agent ซ้ำ / fallback ทับ race ที่ยังค้าง) ที่จะทำให้บอทจองแข่งกันเองจน quota เต็ม แล้วรายงาน false-`❌`.
- **Idempotent marker** — จองสำเร็จ → เขียน `state/booked-<targetDate>.json` เก็บ `(account, hour, bookingCode)`. `run` โหลด marker ก่อน → skip task ที่ได้แล้ว, auth เฉพาะ account ที่ค้าง. fallback จึงไม่จองซ้ำ/ไม่แจ้ง false-❌.
- **Telegram** — แจ้งผลทุกครั้ง (✅/❌) + แจ้ง crash. เงียบ = ผิดปกติ.
- **Dead-man switch (healthchecks.io)** — `run.sh` ping `/start` + success + `/$code`. ถ้าเครื่องตาย/agent ไม่ยิง → healthchecks ไม่ได้ ping ตาม cron → เด้งเตือนเอง.

เวลา race ตั้งใน `config.json` → `race.fireAt` / `race.deadline` / `race.retryDelayMs`. วัน/slot/ลำดับ court อยู่ใน `config.json` → `schedule`.

## 3. Setup บน Mac mini

> ⚠️ รันบนเครื่องส่วนตัวเท่านั้น — เครื่องทำงานที่มี corporate MITM proxy (Netskope/Zscaler) จะทำให้ทุก HTTPS request ล้ม (`self signed certificate in certificate chain`) รวมถึง Telegram alert → fail เงียบ. และ laptop ที่หลับได้จะยิง launchd สายจนเลย deadline.

ทำครั้งเดียว:

```sh
# 1. clone (repo private — login GitHub / PAT)
xcode-select --install 2>/dev/null   # ถ้ายังไม่มี git
git clone https://github.com/onepiecepuracr-satod07/botbookyoucourt.git
cd botbookyoucourt

# 2. วาง .env (AirDrop จากเครื่องเดิม หรือ cp .env.example .env แล้วกรอก)
#    ต้องมี: TU_A_USERNAME/PASSWORD, TU_B_USERNAME/PASSWORD,
#            TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, HEALTHCHECK_URL

# 3. bootstrap: ลง bun, deps, pmset no-sleep, สร้าง+load launchd 2 ตัว, smoke test
zsh scripts/setup-macmini.sh
```

ตั้งเพิ่มด้วยมือ:

- **healthchecks.io check** → Schedule = **Cron** `55 6 * * 0,1`, Time Zone **Asia/Bangkok**, Grace 30 min–1h → เอา Ping URL ใส่ `HEALTHCHECK_URL` ใน `.env`
- **Auto-login** (System Settings → Users & Groups → Automatically log in) — LaunchAgent รันใน GUI session; ไฟดับ→autorestart รีบูต→ต้อง auto-login agent ถึงกลับมา

`setup-macmini.sh` ทำ: ลง bun (ถ้าไม่มี) · `bun install --frozen-lockfile` · `sudo pmset -a sleep 0 disksleep 0 autorestart 1 powernap 0` · gen plist จาก path ปัจจุบัน + `launchctl load -w` · `status` smoke test. ย้าย repo ไป path อื่นแล้วรันซ้ำได้.

## 4. ทดสอบ

```sh
# safe — ไม่จอง (dry-run ผ่าน wrapper: เทส PATH/env, auth, API, ping healthchecks)
zsh scripts/test-schedule.sh

# live — kickstart fallback agent จริงทันที (ไม่ต้องรอ Sun)
zsh scripts/test-schedule.sh --live
```

⚠️ `--live` = `run --now`: จองจริงถ้า `today+6` เป็น Sat/Sun. ถ้า `today+6` เป็นวันอื่น → ไม่มีใน schedule → no-op ปลอดภัย (เทส wiring ได้โดยไม่จอง).

smoke test แยก:
```sh
# Telegram
source .env; curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -d chat_id="$TELEGRAM_CHAT_ID" -d text="test"; echo
# API + auth (จาก IP ไทยเท่านั้น)
bun src/index.ts status
```

## 5. Operations

```sh
# ดู agent ที่ load + สถานะ
launchctl list | grep botbookyoucourt              # ใช้ได้เฉพาะใน GUI/Aqua session
# ⚠️ ผ่าน ssh: launchctl list เห็นเปล่า (คนละ session domain) — ใช้ gui domain แทน
launchctl print gui/$(id -u) | grep -iE 'book|=> (en|dis)abled'

# log
tail -f logs/$(date +%F).log          # log แอปรายวัน
tail -n 40 logs/launchd.out.log logs/launchd.err.log

# จองมือ (กรณี fallback ก็แล้วยังไม่ได้)
bun src/index.ts book --date 2026-08-01 --hour 17 --court 5 --account aof
bun src/index.ts cancel --account aof --code <bookingCode>

# reload หลังแก้ config/โค้ด
git pull && bun install
launchctl unload ~/Library/LaunchAgents/com.botbookyoucourt.race.plist
launchctl load -w ~/Library/LaunchAgents/com.botbookyoucourt.race.plist   # (ทำกับ .fallback ด้วย)
# หรือรัน scripts/setup-macmini.sh ซ้ำ (unload+load ให้เอง)

# ปิดชั่วคราว
launchctl unload ~/Library/LaunchAgents/com.botbookyoucourt.{race,fallback}.plist
```

marker: ลบ `state/booked-<date>.json` ถ้าต้องการบังคับให้ยิงจองวันนั้นใหม่.

## 6. Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| healthchecks แดง เช้า Sun/Mon | เครื่อง/เน็ต/ไฟดับ, agent ไม่ยิง | จองมือทันที (คอร์ตมักว่างถึง ~08:24) แล้วเช็คเครื่อง |
| Telegram เงียบเช้า Sun/Mon | เหมือนข้างบน (bot ไม่ได้รัน) | ดู `launchd.err.log`, `launchctl list` |
| `run` ค้างนาน ไม่มี log | connect API timeout = ไม่ได้อยู่ IP ไทย / เน็ตหลุด | ยืนยัน `curl -m10 https://bookyourcourtapi.psm.tu.ac.th/` ได้ 302 |
| `❌ ... token` ทุก account | creds ใน `.env` ผิด/หมดอายุ | อัปเดต `.env`, ทดสอบ `bun src/index.ts status` |
| `self signed certificate in certificate chain` ทุก request (TU + Telegram พร้อมกัน) | เครื่องมี corporate MITM proxy (เช่น Netskope/Zscaler) — bun ไม่ trust CA ของ proxy | อย่ารัน bot บนเครื่องทำงาน; ถ้าจำเป็นชั่วคราว: export CA ของ proxy เป็น .pem แล้วตั้ง `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` ใน plist/run.sh |
| `CreateOrEdit: Internal server error` ทั้งที่ auth ผ่าน | user TU ของ account นั้นหมดอายุ (ไม่มีสิทธิ์จอง) | ต่ออายุ user กับ TU; ระหว่างรอ เอา account ออกจาก `config.json` กัน bot ยิง 500 ฟรี |
| log `no attempt made` | run เริ่มหลัง `deadline` 07:02 (เครื่องหลับแล้ว launchd ยิงตอนตื่น) | เช็ค pmset (แถวล่าง) + ต้องมี fallback agent 07:10 (`launchctl list \| grep botbook` ต้องเห็น 2 ตัว) |
| จองไม่ได้แต่ไม่มี error ชัด | slot ถูกคนอื่นแย่ง (race แพ้) | fallback 07:10 เก็บตก; ถ้ายัง = จองมือ |
| log ซ้ำทุกบรรทัด 2 รอบ / จองสำเร็จแล้วยังได้ `❌ FAILED` | มี launchd agent ซ้ำยิงเวลาเดียวกัน → 2 instance ชนกันเอง จน quota เต็ม (issue #4) | `launchctl print gui/$(id -u) \| grep book` ต้องเหลือแค่ `race`+`fallback`; ลบ agent เกิน (`launchctl bootout gui/$(id -u)/<label>` + `rm ~/Library/LaunchAgents/<label>.plist`). `run.sh` มี lock กันชั้นสองแล้ว |
| เครื่องหลับตอน 06:55 | pmset ไม่ได้ตั้ง / เครื่องรีบูตแล้วไม่ auto-login | `pmset -g \| grep sleep` ต้อง 0; เปิด auto-login |
| agent ไม่ทำงานหลังรีบูต | ไม่ได้ auto-login | เปิด auto-login |

## 7. อ้างอิง

- **Schedule:** run **Sun** (จองคอร์ตเสาร์) + **Mon** (จองคอร์ตอาทิตย์). booking window = target `today+6` (slot เปิด 07:00 ICT ล่วงหน้า 6 วัน).
- **Race timing** (`config.json`): pre-auth ตอน agent ตื่น 06:55 → `fireAt` 06:59:58 → retry ทุก 500ms → `deadline` 07:02.
- **Play slot:** Sat+Sun 17:00–19:00, court priority `[5, 4, any]` (2 ชม. = 2 accounts เพราะ 1 จอง/user/วัน).
- **Court map:** 01→39, 02→40, 03→41, 04→51, 05→52 · `sportTypeId=3` · `sportStationId=4`.
- **Grid values:** `1`=ว่าง, `-1`=ถูกจอง, `null`/`.`=ปิด.
- **Host:** Mac mini M4 บ้าน (Thai IP). repo private `onepiecepuracr-satod07/botbookyoucourt`.
