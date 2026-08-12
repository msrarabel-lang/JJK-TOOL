# JJK Cursed Energy & Domain Tracker

Extension สำหรับ SillyTavern (ไม่ใช่ Regex/Lorebook) — สร้าง HUD ลอยถาวรที่:

1. **Cursed Energy meter** — จำค่าข้ามข้อความ/ข้ามการรีโหลดหน้าเว็บได้เอง ไม่ต้องรอ AI ส่ง JSON ทุกครั้ง ปรับค่า +/- ได้จากปุ่มในแผงควบคุม
2. **Domain Expansion Cooldown** — นับจำนวนข้อความจริงตั้งแต่ครั้งล่าสุดที่ตรวจพบคำว่า "domain expansion" ในข้อความของ AI แล้วส่งข้อความเตือนแทรกเข้า prompt อัตโนมัติระหว่างที่ยังติดคูลดาวน์ ("Do not have {{char}} use Domain Expansion until the cooldown ends.")

## ⚠️ สำคัญ — อ่านก่อนติดตั้ง

ผมเขียนโค้ดนี้โดยอิงตาม API มาตรฐานของ SillyTavern (`window.SillyTavern.getContext()`) และ **ทดสอบ logic ทั้งหมดผ่าน mock จำลอง** (ปุ่มกด, การคำนวณคูลดาวน์, การบันทึกค่า, การตรวจจับคำในข้อความ) ยืนยันว่าทำงานถูกต้อง 100% — แต่**ไม่ได้ทดสอบกับ SillyTavern จริงที่รันอยู่** เพราะไม่มีอินสแตนซ์ให้เชื่อมต่อในสภาพแวดล้อมนี้

ถ้าติดตั้งแล้วมีปัญหา ให้เปิด Console ของเบราว์เซอร์ (กด F12 → แท็บ Console) จะเห็น log ที่ขึ้นต้นด้วย `[jjk-cursed-tracker]` บอกชัดเจนว่าจุดไหนหา API ไม่เจอ — ส่ง log นั้นมาให้ผมดูได้เลย จะแก้ให้ตรงจุด

## วิธีติดตั้ง

**วิธีที่ 1 — SFTP/File Manager (แนะนำ)**
1. เข้า Server ผ่าน SFTP หรือ File Manager ของผู้ให้บริการ VPS
2. หาโฟลเดอร์ SillyTavern ของคุณ แล้วไปที่ `public/scripts/extensions/third-party/`
3. สร้างโฟลเดอร์ใหม่ชื่อ `jjk-cursed-tracker`
4. อัปโหลดไฟล์ทั้ง 3: `manifest.json`, `index.js`, `style.css` ลงในโฟลเดอร์นั้น
5. รีสตาร์ท SillyTavern (หรือ reload หน้าเว็บถ้า server ยังรันอยู่)
6. เข้า SillyTavern → เมนู Extensions (ไอคอนปลั๊ก) → เลื่อนหา "JJK Cursed Energy & Domain Tracker" ในลิสต์ ถ้าเห็นแสดงว่าโหลดสำเร็จ

**วิธีที่ 2 — SSH**
```bash
cd /path/to/SillyTavern/public/scripts/extensions/third-party/
mkdir jjk-cursed-tracker
# อัปโหลดไฟล์ 3 ไฟล์เข้าโฟลเดอร์นี้ (scp/rsync จากเครื่องคุณ)
```

## วิธีใช้งาน

- หลังติดตั้งสำเร็จ จะเห็น**เม็ดยาลอย** มุมล่างขวาของหน้าจอ แสดง 呪 + แถบพลังงาน + ป้าย Domain
- **คลิก**ที่เม็ดยา เพื่อเปิดแผงควบคุม (ปรับ CE, ตั้งคูลดาวน์, แก้คำ trigger)
- **ลาก**เม็ดยา เพื่อย้ายตำแหน่ง (จำตำแหน่งไว้ให้อัตโนมัติ)
- ระบบจะสแกนข้อความล่าสุดของ AI หาคำว่า "domain expansion" (แก้คำได้ในแผงควบคุม) เพื่อเริ่มนับคูลดาวน์เอง — ถ้า AI เขียนชื่อท่าแบบอื่น ให้กด **"Mark Used Now"** เอง
- ปุ่ม **"Force Ready"** ใช้รีเซ็ตคูลดาวน์ทันทีเมื่อต้องการ

## ปรับแต่งเพิ่มเติม

- **Enable HUD** — ปิด/เปิดทั้งระบบ ได้จากเมนู Extensions → ลิ้นชัก "JJK Cursed Energy & Domain Tracker"
- **Cooldown length** — ค่าเริ่มต้น 15 ข้อความ ปรับได้ในแผงควบคุม
- **Trigger phrase** — ค่าเริ่มต้น "domain expansion" (ไม่สนตัวพิมพ์เล็ก-ใหญ่) เปลี่ยนเป็นภาษาไทยหรือคำอื่นได้

## ข้อจำกัดที่รู้อยู่แล้ว

- ระบบ**เตือน** AI ผ่านการแทรก prompt เท่านั้น ไม่สามารถ**บังคับ**ห้าม AI เขียนเนื้อหาได้จริง 100% (LLM อาจมองข้ามคำเตือนได้ในบางครั้ง)
- ถ้า SillyTavern เวอร์ชันที่ใช้ไม่มี `setExtensionPrompt` หรือ event ชื่อ `MESSAGE_RECEIVED` ตรงตามที่คาดไว้ ฟีเจอร์ auto-cooldown/auto-warn จะไม่ทำงาน แต่ HUD และปุ่มควบคุมมือจะยังใช้ได้ปกติ (เช็ค log ใน Console ตามข้างบน)
