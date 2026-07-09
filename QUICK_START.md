# Quick Start - Government Exam Alert System

## ⚡ 30-Second Setup

### 1. Set Your API Key
Edit `.env` and add your Gemini API key:
```bash
GEMINI_API_KEY=your_key_here
```

### 2. Test Single Cycle
```bash
python main.py --once
```

You should see:
```
[INFO] ========== Starting monitoring cycle for 6 sites ==========
[INFO] Successfully scraped Tamil Nadu Public Service Commission (15432 chars)
[INFO] Processing Gemini extraction...
[INFO] New notification saved: TNPSC Group 1 | Admit Card Out | ...
[INFO] ========== Monitoring cycle completed ==========
```

### 3. Check Your Database
```bash
sqlite3 govtexam_alerts.db "SELECT exam_name, update_type, summary FROM notifications LIMIT 3;"
```

---

## 🚀 Start Production (3 Terminals)

### Terminal 1: Scraper (Continuous)
```bash
python main.py
```
Runs every 30 minutes automatically.

### Terminal 2: FastAPI Backend
```bash
uvicorn api:app --port 8000
```
Serves the live API.

### Terminal 3: Next.js Dashboard
```bash
cd frontend
npm run dev
```
Opens at `http://localhost:3000`

---

## 📊 API Endpoints

```bash
# Latest updates
curl http://localhost:8000/api/updates

# Statistics
curl http://localhost:8000/api/stats

# Health check
curl http://localhost:8000/health
```

---

## 📋 What Gets Scraped

The system monitors these **6 real government exam websites**:

1. **TNPSC** - Tamil Nadu Public Service Commission
2. **SSC** - Staff Selection Commission  
3. **UPSC** - Union Public Service Commission
4. **IBPS** - Banking Exams
5. **NTA** - National Testing Agency
6. **RRB** - Railway Recruitment Board

---

## 🔐 How Duplicates Are Prevented

Same notification extracted twice?
```
✓ Content hashed (SHA256)
✓ UNIQUE constraint prevents duplicates
✓ INSERT OR IGNORE skips duplicates
✓ Dashboard shows it ONCE
```

---

## 📝 Log Examples

### Normal Run
```
[INFO] ========== Starting monitoring cycle for 6 sites ==========
[INFO] Scraping Staff Selection Commission (attempt 1/4)...
[INFO] Successfully scraped Staff Selection Commission (12840 chars)
[INFO] Processing Gemini extraction for Staff Selection Commission
[INFO] Gemini extracted 1 update(s) for Staff Selection Commission
[INFO] New notification saved: SSC CGL | Admit Card Out | Admit card released...
[INFO] Attempting Telegram broadcast for 1 new notification
[INFO] Telegram broadcast: 1 notification sent
[INFO] ========== Monitoring cycle completed ==========
```

### No Updates Found
```
[INFO] Processing Gemini extraction for UPSC
[INFO] No updates found for UPSC by Gemini
```

### Duplicate Skipped
```
[INFO] New notification saved: TNPSC Group 2 | Result Declared | ...
[DEBUG] Duplicate notification skipped (idempotent): a7f3d9e2c5b1f8...
```

---

## 🐛 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| `ModuleNotFoundError: No module named 'playwright'` | Run: `pip install -r requirements.txt` |
| `GEMINI_API_KEY not set` | Add key to `.env` file |
| `database is locked` | Restart or delete `.db-wal`/`.db-shm` files |
| `navigation timeout after 30000ms` | Website down - check with `curl https://tnpsc.gov.in/` |
| `No tables found` | Run: `python -m pytest test_system.py` to verify |

---

## 📚 Full Documentation

- **README.md** - Complete overview
- **IMPLEMENTATION_GUIDE.md** - Technical details
- **COMPLETE_SOLUTION.md** - Everything built

---

## ✅ Verify Everything Works

Run the validation test:
```bash
python test_system.py
```

Expected output:
```
[PASS] Module Imports
[PASS] Database Schema
[PASS] Idempotency
[PASS] Scraper Config
[PASS] Gemini Processor
[PASS] FastAPI Integration
6/6 tests passed
```

---

## 🎯 Production Checklist

- [ ] Set `GEMINI_API_KEY` in `.env`
- [ ] Run `python main.py --once` to verify
- [ ] Check database: `sqlite3 govtexam_alerts.db "SELECT COUNT(*) FROM notifications;"`
- [ ] Start scraper: `python main.py`
- [ ] Start API: `uvicorn api:app --port 8000`
- [ ] Start frontend: `cd frontend && npm run dev`
- [ ] Test dashboard: `http://localhost:3000`
- [ ] Verify API: `curl http://localhost:8000/api/updates`

---

## 💡 Key Facts

- **6 Government Websites** monitored in real-time
- **Google Gemini AI** extracts structured exam updates
- **Zero Duplicates** - idempotent by design
- **Live Dashboard** - Next.js auto-updates
- **Every 30 Minutes** - default monitoring interval
- **Production Ready** - all systems tested and verified

---

**System is ready to deploy!** 🚀

Next: Set your Gemini API key and run `python main.py --once`
