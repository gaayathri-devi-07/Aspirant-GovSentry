# Government Exam Update Tracking Agent

A production-ready Python agent for scraping **live government exam websites**, extracting real updates with **Google Gemini AI**, storing them in **SQLite with idempotency**, and broadcasting alerts to **Telegram**. The repository includes a **Next.js dashboard** for live visibility into alerts.

---

## 🎯 Architecture Overview

```
┌─────────────────┐
│  Playwright     │
│  Web Scraper    │ ──> Scrapes TNPSC, SSC, UPSC, IBPS, NTA, RRB
└─────────────────┘
         │
         ↓
┌─────────────────┐
│ Google Gemini   │
│  AI Processor   │ ──> Extracts structured exam updates (JSON)
└─────────────────┘
         │
         ↓
┌─────────────────┐
│  SQLite DB      │
│ (Idempotent)    │ ──> Prevents duplicate notifications
└─────────────────┘
         │
         ├──> Telegram Notifier (Real-time alerts)
         │
         └──> FastAPI REST API ──> Next.js Dashboard
```

---

## 🔧 Setup & Installation

### Prerequisites
- Python 3.10+
- Node.js 18+ (for frontend)
- Google Gemini API key
- Telegram Bot token & chat ID (optional, for notifications)

### Backend Setup

1. **Clone and navigate to the repo:**
   ```bash
   cd govtexam-alert
   ```

2. **Create virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```

4. **Configure environment variables** in `.env`:
   ```env
   # Database
   DATABASE_PATH=govtexam_alerts.db
   
   # AI Processing
   GEMINI_API_KEY=your_gemini_api_key_here
   
   # Notifications (optional)
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHAT_ID=your_telegram_chat_id
   
   # Scraping
   SCRAPE_INTERVAL_MINUTES=30
   HEADLESS=true
   LOG_LEVEL=INFO
   
   # FastAPI
   ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8000
   FASTAPI_HOST=0.0.0.0
   FASTAPI_PORT=8000
   ```

---

## 🚀 Usage

### Option 1: Run a Single Monitoring Cycle

**Scrapes all sites, extracts updates, saves to DB, and exits:**
```bash
python main.py --once
```

**Expected Terminal Output:**
```
[INFO] ========== Starting monitoring cycle for 6 sites ==========
[INFO] Scraping Tamil Nadu Public Service Commission (attempt 1/4)...
[INFO] Successfully scraped Tamil Nadu Public Service Commission (15432 chars)
[INFO] Processing Gemini extraction for Tamil Nadu Public Service Commission
[INFO] Gemini extracted 2 update(s) for Tamil Nadu Public Service Commission
[INFO] New notification saved: TNPSC Group 1 | Admit Card Out | Admit card released for Group 1 exam scheduled on...
[INFO] Duplicate notification skipped (idempotent): a7f3d9e2c...
[INFO] ========== Monitoring cycle completed ==========
```

### Option 2: Run Continuous Monitoring (Default: Every 30 Minutes)

```bash
python main.py
```

Or with custom interval (in minutes):
```bash
python main.py --interval 15
```

### Option 3: Start FastAPI Service + Dashboard

**Terminal 1 - Start the FastAPI backend:**
```bash
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Start Next.js frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Access the dashboard:**
- Backend API: `http://localhost:8000`
- Dashboard: `http://localhost:3000`
- Health check: `http://localhost:8000/health`
- Latest updates: `http://localhost:8000/api/updates`
- Stats: `http://localhost:8000/api/stats`

---

## 📊 Database Schema

The SQLite database stores all notifications with **idempotency via content_hash**:

```sql
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_name TEXT NOT NULL,              -- e.g., "TNPSC Group 1"
    update_type TEXT NOT NULL,            -- Admit Card Out | Date Changed | Result Declared | etc.
    old_value TEXT,                       -- Previous date/status
    new_value TEXT,                       -- Current date/status
    summary TEXT NOT NULL,                -- Single-sentence update
    source_url TEXT NOT NULL,             -- e.g., https://tnpsc.gov.in/
    site_name TEXT NOT NULL,              -- e.g., Tamil Nadu Public Service Commission
    raw_text TEXT NOT NULL,               -- Full page content
    content_hash TEXT NOT NULL UNIQUE,    -- SHA256(site + exam + old + new + summary)
    created_at TEXT NOT NULL,             -- ISO8601 timestamp
    telegram_sent INTEGER DEFAULT 0       -- 0=pending, 1=sent
);

CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_site_name ON notifications(site_name);
CREATE INDEX idx_notifications_exam_name ON notifications(exam_name);
CREATE UNIQUE INDEX idx_notifications_idempotency ON notifications(content_hash);
```

---

## 🤖 AI Processing Pipeline

### How Gemini Extraction Works

1. **Scraper** fetches raw HTML text from each site
2. **Playwright** waits for `networkidle` and dynamic content to load
3. **Gemini API** receives a strict prompt:
   ```
   You are an expert parser for Indian Government Exam updates.
   Search for any active, new updates regarding exam dates, admit cards, or results.
   
   If a real update is found, extract it EXACTLY into this JSON schema:
   {
     "exam_name": "Name of the specific exam",
     "update_type": "Admit Card Out" | "Date Changed" | "Result Declared" | ...,
     "old_value": "previous date/status if visible, else null",
     "new_value": "current new date or status",
     "summary": "A concise, single sentence plain-English explanation."
   }
   
   If absolutely no updates or notifications are found, return an empty JSON object: {}
   ```
4. **Parsed JSON** is validated and stored with a deterministic `content_hash`
5. **Database** checks `content_hash` UNIQUE constraint to prevent duplicates
6. **Telegram** broadcasts only new notifications

### Update Types Recognized
- `Admit Card Out` – Admit card released
- `Date Changed` – Exam date postponed or rescheduled
- `Result Declared` – Results published
- `New Exam Announced` – New exam notification
- `Answer Key Released` – Answer key published
- `Notification` – General notification
- `Other` – Unclassified update

---

## 🌐 Scraped Government Sites

The agent currently monitors **6 live government exam websites**:

| Site | URL | Type |
|------|-----|------|
| **TNPSC** | https://tnpsc.gov.in/ | Tamil Nadu Public Service Commission |
| **SSC** | https://ssc.gov.in/ | Staff Selection Commission |
| **UPSC** | https://upsc.gov.in/ | Union Public Service Commission |
| **IBPS** | https://www.ibps.in/ | Institute of Banking Personnel Selection |
| **NTA** | https://nta.ac.in/ | National Testing Agency |
| **RRB Chandigarh** | https://www.rrbcdg.gov.in/ | Railway Recruitment Board |

To add more sites, edit `scraper.py`:
```python
GOVERNMENT_SITES: List[SiteTarget] = [
    SiteTarget(name="Custom Exam Board", url="https://example.gov.in/"),
    # ... more sites
]
```

---

## 📡 API Endpoints

### `GET /api/updates`
Returns the latest notifications (default: 50 limit).

**Response:**
```json
{
  "count": 3,
  "updates": [
    {
      "exam_name": "TNPSC Group 1",
      "update_type": "Admit Card Out",
      "old_value": "pending",
      "new_value": "2026-07-15",
      "summary": "Admit card released for Group 1 examination.",
      "source_url": "https://tnpsc.gov.in/",
      "site_name": "Tamil Nadu Public Service Commission",
      "content_hash": "a7f3d9e2c...",
      "created_at": "2026-07-07T17:58:00+05:30",
      "telegram_sent": true
    },
    ...
  ]
}
```

### `GET /api/stats`
Returns statistics about all notifications.

**Response:**
```json
{
  "total_alerts": 247,
  "total_sites": 6,
  "telegram_sent": 189,
  "last_sync": "2026-07-07T17:58:00+05:30"
}
```

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

---

## 🔒 Idempotency & Duplicate Prevention

**Problem:** Without idempotency, the same notification could be saved multiple times, flooding the dashboard and Telegram.

**Solution:** Each notification is hashed deterministically:

```python
content_hash = SHA256(
    JSON({
        "site_name": "TNPSC",
        "exam_name": "Group 1",
        "old_value": "pending",
        "new_value": "2026-07-15",
        "summary": "Admit card released..."
    })
)
```

- **`INSERT OR IGNORE`** ensures duplicate hashes are silently skipped
- **UNIQUE constraint** on `content_hash` prevents DB conflicts
- **`insert_notification()` returns `bool`** — `True` if new, `False` if duplicate
- Dashboard only shows genuinely new updates

---

## 🔧 Code Components

### `database.py`
- `Database` class: SQLite connection management, WAL mode, indexes
- `insert_notification()`: Idempotent insert with duplicate detection
- `latest_notifications()`: Fetch recent updates (FastAPI uses this)
- `mark_telegram_sent()`: Mark notifications as broadcast
- `stats()`: Return DB statistics

### `scraper.py`
- `scrape_site()`: Playwright headless browser automation with retry logic (max 4 attempts)
- `scrape_all_sites()`: Async scrape all 6 sites in parallel
- Waits for `networkidle` + dynamic content selectors to ensure full page load
- Detailed logging at each step

### `ai_processor.py`
- `GeminiProcessor` class: Initializes Google Generative AI SDK
- `parse_updates()`: Sends scraped text to Gemini with strict prompt
- Falls back to heuristic parsing if Gemini fails or returns empty
- Handles JSON extraction from Gemini response
- `_build_content_hash()`: Deterministic SHA256 hashing for idempotency

### `main.py`
- `GovernmentExamUpdateAgent` class: Orchestrates the full pipeline
- `run_cycle()`: Single monitoring cycle (scrape → Gemini → DB → Telegram)
- `run_forever()`: Continuous loop with configurable interval
- Detailed logging at every stage (INFO, DEBUG, ERROR, WARN)
- Can be run with `--once` or `--interval` arguments

### `api.py`
- FastAPI application with CORS support
- `GET /api/updates`: Returns latest notifications
- `GET /api/stats`: Database statistics
- `GET /health`: Status check

---

## 🧪 Testing the Pipeline

### Test 1: Single Cycle (No Errors)
```bash
python main.py --once
```
✅ Should complete without exceptions and log all stages.

### Test 2: Check Database
```bash
sqlite3 govtexam_alerts.db "SELECT COUNT(*) FROM notifications; SELECT * FROM notifications LIMIT 1;"
```
✅ Should show inserted records with content_hash values.

### Test 3: Test Idempotency
```bash
python main.py --once  # Run twice
```
✅ Second run should not increase notification count (duplicates skipped).

### Test 4: Start FastAPI & Test Endpoints
```bash
# Terminal 1
uvicorn api:app --port 8000

# Terminal 2
curl http://localhost:8000/health
curl http://localhost:8000/api/stats
curl http://localhost:8000/api/updates | jq .
```
✅ All endpoints return valid JSON responses.

---

## 📝 Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | ✅ Yes | — | Google Gemini API key for AI extraction |
| `DATABASE_PATH` | ❌ No | `govtexam_alerts.db` | SQLite database file path |
| `TELEGRAM_BOT_TOKEN` | ❌ No | — | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | ❌ No | — | Telegram chat ID to receive alerts |
| `SCRAPE_INTERVAL_MINUTES` | ❌ No | `30` | Interval between monitoring cycles |
| `HEADLESS` | ❌ No | `true` | Run browser in headless mode |
| `LOG_LEVEL` | ❌ No | `INFO` | Python logging level |
| `ALLOWED_ORIGINS` | ❌ No | `http://localhost:3000` | CORS allowed origins |
| `FASTAPI_HOST` | ❌ No | `0.0.0.0` | FastAPI binding address |
| `FASTAPI_PORT` | ❌ No | `8000` | FastAPI port |

---

## 🐛 Troubleshooting

### Gemini returns empty results
- ✅ **Expected behavior** – The page doesn't contain real exam updates
- ✅ System correctly returns `[]` (no alerts created)
- Verify by checking terminal logs: `[INFO] No updates found for X by Gemini`

### Scraper times out
- Ensure internet connection is stable
- Check if the government site is down: `curl https://tnpsc.gov.in/`
- Increase timeout in `scraper.py`: `timeout=30000` (in milliseconds)

### Database lock errors
- SQLite uses WAL mode, which handles concurrent access
- Ensure no other process is writing to `govtexam_alerts.db`
- Delete `.db-wal` and `.db-shm` files if they exist

### Telegram not receiving notifications
- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`
- Test bot manually: `curl -X GET "https://api.telegram.org/botTOKEN/getMe"`

---

## 📦 Dependencies

- **fastapi** – Web framework
- **uvicorn** – ASGI server
- **playwright** – Headless browser automation
- **google-generativeai** – Gemini AI SDK
- **python-telegram-bot** – Telegram notifications
- **python-dotenv** – Environment variable management
- **pydantic** – Data validation

---

## 📄 License

MIT License – Feel free to use, modify, and distribute.

---

## 🎯 Next Steps

1. ✅ Deploy backend to a cloud server (AWS Lambda, Heroku, DigitalOcean)
2. ✅ Deploy frontend Next.js dashboard to Vercel
3. ✅ Set up CI/CD pipeline to auto-update on new code
4. ✅ Add email notifications alongside Telegram
5. ✅ Implement exam filtering (by state, category, board)
6. ✅ Add user authentication & personalized alerts

---

**Built with ❤️ using Python, Playwright, Gemini AI, and Next.js**
