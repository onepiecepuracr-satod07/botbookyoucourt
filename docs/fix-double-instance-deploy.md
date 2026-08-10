# Deploy: fix double-instance booking

แก้ปัญหา 2 launchd agents ยิงเวลา 06:55 พร้อมกัน (`com.aof.bookyourcourt` +
`com.botbookyoucourt.race`) ทำให้บอทรัน 2 instance ชนกันเอง: ตัวหนึ่งจองคอร์ตได้
อีกตัวโดน per-court quota แล้วรายงาน false-negative `FAILED` (ดู issue #4).

ทางแก้ที่ push แล้ว (commit `7f840dd`):

- `run.sh` — `mkdir` atomic lock + เช็ค pid stale เอง; instance ที่ 2 `exit 0` เงียบ
- `setup-macmini.sh` — unload + rm legacy `com.aof.bookyourcourt` ตอน setup
- ลบ `scripts/install-launchd.sh` (ต้นตอ agent ซ้ำ)

---

## Part 1 — รันบน Mac mini

```sh
cd ~/dev-opensource/botbookyoucourt   # หรือ path repo จริงบน Mac mini
```

### 1. ดูสถานะปัจจุบัน (จดไว้เทียบ)

```sh
launchctl list | grep -iE 'bookyourcourt|aof'
```

คาดเห็น 3 บรรทัด: `com.aof.bookyourcourt`, `com.botbookyoucourt.race`,
`com.botbookyoucourt.fallback`

### 2. ลบ legacy agent ที่ชน

```sh
launchctl unload -w ~/Library/LaunchAgents/com.aof.bookyourcourt.plist
rm ~/Library/LaunchAgents/com.aof.bookyourcourt.plist
```

### 3. ยืนยันเหลือแค่ 2

```sh
launchctl list | grep -iE 'bookyourcourt|aof'
```

ต้องเหลือแค่ `com.botbookyoucourt.race` + `com.botbookyoucourt.fallback`
ไม่มี `com.aof.*` แล้ว

### 4. ดึง code ใหม่ (ได้ run.sh ที่มี lock)

```sh
git pull origin main
```

plist ชี้ path ไป `scripts/run.sh` โดยตรง — pull เสร็จ agents ใช้ตัวใหม่ทันที
ไม่ต้อง reload

### 5. Smoke test — ยืนยัน lock กันซ้ำจริง (ปลอดภัย ไม่จอง)

```sh
zsh scripts/run.sh dry-run &   # instance 1 (จับ lock)
zsh scripts/run.sh dry-run &   # instance 2 (ต้องโดนกัน)
wait
```

instance 2 ต้อง print `another instance running (pid ...); skipping` แล้ว exit
มีแค่ตัวเดียวยิง API

### 6. เช็คว่า lock ไม่ค้าง

```sh
ls state/.run.lock 2>/dev/null && echo "LOCK STUCK (bad)" || echo "clean (good)"
```

ต้องได้ `clean (good)` — `trap` ลบ lock ตอน process จบแล้ว

### 7. (วันจันทร์/อาทิตย์ถัดไป) เช็ค log ว่าไม่ double

```sh
grep -c 'INFO plan:' logs/$(date +%F).log
```

ต้องได้ `1` (เดิม double = `2`)

---

## Rollback

ถ้าอยากคืน agent ให้ครบใหม่:

```sh
zsh scripts/setup-macmini.sh
```

จะ setup race + fallback ให้ครบ และลบ legacy ให้อัตโนมัติ
