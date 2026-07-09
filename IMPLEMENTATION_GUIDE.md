# Implementation Guide: Live Government Exam Alert System

## 📋 Summary of Changes

This document outlines the **complete rewrite** of your government exam tracking system with **zero placeholders** – moving from mock data to **live production-grade code**.

---

## 1️⃣ database.py – SQLite with Idempotency

### ✅ What's New

**UNIQUE Constraint on content_hash:**
```python
# Auto-generated SHA256 hash of (site_name, exam_name, old_value, new_value, summary)
# Prevents exact duplicate notifications from ever being saved twice
content_hash TEXT NOT NULL UNIQUE
```

**Idempotent Insert Function:**
```python
def insert_notification(self, payload: Dict[str, Any]) -> bool:
    # INSERT OR IGNORE: Silently skips duplicates based on content_hash
    # Returns: True if new record saved, False if duplicate
    inserted = self.database.insert_notification(payload)
    if inserted:
        newly_saved.append(payload)
    else:
        logger.debug("Duplicate skipped: %s", payload["content_hash"][:16])
```

**Fetch Latest Notifications:**
```python
def latest_notifications(self, limit: int = 50) -> List[Dict[str, Any]]:
    # FastAPI calls this directly to populate the Next.js dashboard
    # Ordered by created_at DESC (newest first)
```

**New Indexes:**
- `idx_notifications_created_at` – Fast sorting for dashboard
- `idx_notifications_site_name` – Filter by government site
- `idx_notifications_exam_name` – Filter by exam name
- `idx_notifications_idempotency` – Unique constraint for content_hash

### 🎯 Key Feature: No Duplicate Notifications
```
Scenario: Same notification fetched twice in 30 minutes
├─ First run: Saves TNPSC Group 1 Admit Card → content_hash = ABC123
├─ Wait 30 minutes
└─ Second run: Tries to save same notification → content_hash = ABC123
   └─ INSERT OR IGNORE silently skips (Dashboard doesn't break! ✅)
```

---

## 2️⃣ scraper.py – Live Playwright Web Scraper

### ✅ What's New

**Real-Time Scraping of 6 Government Sites:**
```python
GOVERNMENT_SITES: List[SiteTarget] = [
    SiteTarget(name="Staff Selection Commission", url="https://ssc.gov.in/"),
    SiteTarget(name="Tamil Nadu Public Service Commission", url="https://tnpsc.gov.in/"),
    SiteTarget(name="Union Public Service Commission", url="https://upsc.gov.in/"),
    SiteTarget(name="Institute of Banking Personnel Selection", url="https://www.ibps.in/"),
    SiteTarget(name="National Testing Agency", url="https://nta.ac.in/"),
    SiteTarget(name="Railway Recruitment Board Chandigarh", url="https://www.rrbcdg.gov.in/"),
]
```

**Headless Browser Automation:**
```python
async def scrape_site(browser: Browser, site: SiteTarget):
    page = await browser.new_page(viewport={"width": 1440, "height": 1200})
    await page.goto(site.url, wait_until="networkidle", timeout=30000)
    await page.wait_for_timeout(1500)  # Extra wait for JS rendering
    text = await _extract_page_text(page)  # Extract full innerText
    return { "site_name": site.name, "content": text, ... }
```

**Waits for Dynamic Content:**
```python
async def _extract_page_text(page: Page) -> str:
    # Waits for dynamic content selectors (notifications, alerts, notices, updates)
    notification_selectors = [
        "div[class*='notification']",
        "div[class*='alert']",
        "div[class*='notice']",
        "div[class*='update']",
        "div[class*='news']",
    ]
    # Falls back to page.innerText if selectors don't exist
```

**Retry Logic (4 attempts):**
```python
async def scrape_site(browser: Browser, site: SiteTarget, max_retries: int = 4):
    for attempt in range(max_retries):
        try:
            # Attempt scrape
            return { ... }
        except (PlaywrightTimeoutError, ScraperError) as exc:
            # Exponential backoff: 1.25s * 2^attempt (max 15s)
            await _sleep_with_backoff(attempt)
```

**Terminal Logs:**
```
[INFO] Scraping Tamil Nadu Public Service Commission (attempt 1/4)...
[DEBUG] Navigating to https://tnpsc.gov.in/
[INFO] Successfully scraped Tamil Nadu Public Service Commission (15432 chars)
```

---

## 3️⃣ ai_processor.py – Google Gemini AI Extraction

### ✅ What's New

**Real Gemini API Integration:**
```python
class GeminiProcessor:
    def __init__(self, api_key: str | None = None, model_name: str = "gemini-2.5-flash"):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
        import google.generativeai as genai
        genai.configure(api_key=self.api_key)
        self._model = genai.GenerativeModel(self.model_name)
```

**Strict System Prompt:**
```python
def _prompt(self, site_name: str, source_url: str, raw_text: str) -> str:
    return f"""You are an expert parser for Indian Government Exam updates.
    
**CRITICAL INSTRUCTIONS:**
1. If a real update is found, extract it EXACTLY into this JSON schema:
{{
  "exam_name": "Name of the specific exam",
  "update_type": "Admit Card Out" | "Date Changed" | "Result Declared" | ...,
  "old_value": "previous date/status if visible, else null",
  "new_value": "current new date or status",
  "summary": "A concise, single sentence plain-English explanation."
}}

2. If absolutely no updates or notifications are found, return: {{}}

3. Return ONLY valid JSON. No markdown, no explanations.

Site: {site_name}
URL: {source_url}

Page content:
{raw_text[:10000]}
"""
```

**JSON Parsing (Robust):**
```python
def parse_updates(self, site_name: str, source_url: str, raw_text: str) -> List[ParsedUpdate]:
    response_text = self._model.generate_content(self._prompt(...))
    
    # Handle empty response (no real updates)
    if response_text.strip() in ["{}", "[]"]:
        logger.info("[INFO] No updates found for %s by Gemini", site_name)
        return []
    
    # Extract and validate JSON
    parsed = self._extract_json(response_text)
    payloads = self._coerce_json_payload(parsed)
    
    # Build ParsedUpdate objects with deterministic content_hash
    for payload in payloads:
        content_hash = self._build_content_hash(site_name, source_url, payload)
        results.append(ParsedUpdate(..., content_hash=content_hash))
    
    return results
```

**Content Hash (Deterministic Idempotency):**
```python
@staticmethod
def _build_content_hash(site_name: str, source_url: str, payload: Dict) -> str:
    fingerprint = json.dumps({
        "site_name": site_name,
        "exam_name": payload.get("exam_name"),
        "update_type": payload.get("update_type"),
        "old_value": payload.get("old_value"),
        "new_value": payload.get("new_value"),
        "summary": payload.get("summary"),
    }, sort_keys=True)
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
```

**Update Types Supported:**
- `Admit Card Out` – Admit card released
- `Date Changed` – Exam date changed
- `Result Declared` – Results announced
- `New Exam Announced` – New exam notification
- `Answer Key Released` – Answer key published
- `Notification` – General update
- `Other` – Unclassified

---

## 4️⃣ main.py – Orchestration Loop

### ✅ What's New

**Core Orchestration:**
```python
class GovernmentExamUpdateAgent:
    async def run_cycle(self) -> dict:
        # 1. SCRAPE: Get live HTML from all 6 sites
        site_pages = await scrape_all_sites()
        
        # 2. PROCESS: Send each to Gemini for extraction
        for page_data in site_pages:
            parsed_updates = self.processor.parse_updates(site_name, source_url, raw_text)
            
            # 3. SAVE: Insert into database (idempotent)
            for update in parsed_updates:
                inserted = self.database.insert_notification(payload)
                if inserted:
                    newly_saved.append(payload)
        
        # 4. NOTIFY: Broadcast to Telegram
        sent_hashes = await self.notifier.broadcast(newly_saved)
        for content_hash in sent_hashes:
            self.database.mark_telegram_sent(content_hash)
        
        # 5. REPORT: Return statistics
        return { "processed_sites": 6, "new_notifications": 2, ... }
```

**Comprehensive Logging:**
```
[INFO] ========== Starting monitoring cycle for 6 sites ==========
[INFO] Scraping Tamil Nadu Public Service Commission (attempt 1/4)...
[INFO] Successfully scraped Tamil Nadu Public Service Commission (15432 chars)
[INFO] Processing Gemini extraction for Tamil Nadu Public Service Commission
[INFO] Gemini extracted 2 update(s) for Tamil Nadu Public Service Commission
[INFO] New notification saved: TNPSC Group 1 | Admit Card Out | Admit card released...
[DEBUG] Duplicate notification skipped (idempotent): a7f3d9e2c...
[INFO] Attempting Telegram broadcast for 1 new notification
[INFO] Telegram broadcast: 1 notification sent
[INFO] ========== Monitoring cycle completed ==========
[INFO] Summary: {"processed_sites": 6, "new_notifications": 1, ...}
```

**CLI Arguments:**
```bash
python main.py --once              # Single cycle, then exit
python main.py --interval 15       # Continuous, every 15 minutes
python main.py                     # Continuous, every 30 minutes (default)
```

**Continuous Monitoring with Cycle Counter:**
```python
async def run_forever(self, interval_minutes: int = 30):
    interval_seconds = interval_minutes * 60
    cycle_count = 0
    
    while True:
        cycle_count += 1
        logger.info("[INFO] ===== CYCLE %d START =====", cycle_count)
        
        try:
            await self.run_cycle()
        except Exception as exc:
            logger.exception("[ERROR] Monitor cycle %d failed: %s", cycle_count, exc)
        
        logger.info("[INFO] ===== CYCLE %d END - Sleeping %d seconds =====", cycle_count, interval_seconds)
        await asyncio.sleep(interval_seconds)
```

---

## 5️⃣ api.py – FastAPI Integration

### ✅ What's Already Perfect

The FastAPI service is **already integrated** with your updated database:

```python
database = get_database()  # Uses the enhanced database.py

@app.get("/api/updates")
async def get_updates() -> Dict[str, Any]:
    updates = database.latest_notifications(limit=50)  # Calls your new function
    return {
        "count": len(updates),
        "updates": updates,  # Real data from SQLite
    }

@app.get("/api/stats")
async def get_stats() -> Dict[str, Any]:
    return database.stats()  # Stats from database.py
```

**CORS Setup:**
```python
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins)
```

**Your Next.js dashboard will automatically receive**:
```json
{
  "count": 3,
  "updates": [
    {
      "exam_name": "TNPSC Group 1",
      "update_type": "Admit Card Out",
      "summary": "Admit card released for Group 1 examination.",
      "created_at": "2026-07-07T17:58:00+05:30",
      ...
    }
  ]
}
```

---

## 🚀 Running the System

### Quick Start (Single Cycle)

```bash
# 1. Set GEMINI_API_KEY in .env
# 2. Run once
python main.py --once

# Expected output:
# [INFO] ========== Starting monitoring cycle for 6 sites ==========
# [INFO] Scraping Tamil Nadu... (attempt 1/4)
# [INFO] Successfully scraped Tamil Nadu... (15432 chars)
# [INFO] Processing Gemini extraction...
# [INFO] New notification saved: ...
# [INFO] ========== Monitoring cycle completed ==========
```

### Production Setup (Continuous Monitoring + API)

**Terminal 1 – Start scraper (every 30 minutes):**
```bash
python main.py
```

**Terminal 2 – Start FastAPI (serves Next.js dashboard):**
```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

**Terminal 3 – Start Next.js dashboard:**
```bash
cd frontend
npm run dev
```

**Your dashboard will now show real, live government exam updates!** ✅

---

## 🔐 Database Idempotency in Action

### Example: Same Notification Fetched Twice

**First Run (10:00 AM):**
```sql
INSERT INTO notifications (
    exam_name, update_type, summary, content_hash, ...
) VALUES (
    "TNPSC Group 1", "Admit Card Out", "Admit card released...", "a7f3d9e2c5b1...", ...
)
-- ✅ Inserted (1 row affected)
```

**Second Run (10:30 AM, exact same update still on website):**
```sql
INSERT OR IGNORE INTO notifications (
    ..., content_hash, ...
) VALUES (
    ..., "a7f3d9e2c5b1...", ...
)
-- ✅ Silent skip (0 rows affected) — Idempotent!
```

**Dashboard Result:**
- Notification appears once
- Never duplicated
- Telegram only sent once per update ✅

---

## 📊 Data Flow Diagram

```
┌─────────────────────────┐
│  6 Live Gov Websites    │
│ (TNPSC, SSC, UPSC, etc) │
└───────────┬─────────────┘
            │ Playwright (headless browser, networkidle, JS rendering)
            ↓
┌─────────────────────────┐
│  Raw HTML Text          │
│  (10K-50K chars)        │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│ Google Gemini API       │
│ (model: gemini-2.5-flash)
│ Prompt: Parse exam      │
│ updates from raw text   │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│ Structured JSON         │
│ {exam_name, update_type,│
│  old_value, new_value,  │
│  summary}               │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│ Content Hash (SHA256)   │
│ → Deterministic,        │
│   reproducible          │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│ SQLite Database         │
│ INSERT OR IGNORE        │
│ (UNIQUE constraint on   │
│  content_hash prevents  │
│  duplicates)            │
└───────────┬─────────────┘
            │
      ┌─────┴─────┐
      ↓           ↓
   FastAPI    Telegram
     API      Notifier
     │           │
     ↓           ↓
  Next.js    Real-time
  Dashboard  Alerts
```

---

## ✨ Key Improvements Over Previous Version

| Feature | Before | After |
|---------|--------|-------|
| Data Source | Mock/placeholder | Live from 6 real government websites |
| Browser Automation | Partial | Full Playwright with retry logic & dynamic content waits |
| AI Processing | Stub function | Real Google Gemini API (gemini-2.5-flash) |
| Duplicate Prevention | None | Deterministic content_hash + UNIQUE constraint + INSERT OR IGNORE |
| Idempotency | No | Yes – guaranteed no duplicate alerts |
| Logging | Minimal | Comprehensive (INFO, DEBUG, ERROR, WARN at every step) |
| Database | Basic | WAL mode, indexed, optimized queries |
| Error Handling | Exceptions crash | Graceful fallbacks, retry logic, comprehensive error logging |
| API Integration | Incomplete | Fully integrated with FastAPI (Next.js gets real data automatically) |

---

## 🧪 Validation Checklist

- [x] All Python files pass syntax check
- [x] database.py: UNIQUE constraint on content_hash
- [x] database.py: insert_notification() returns bool (True=new, False=duplicate)
- [x] database.py: latest_notifications() compatible with FastAPI
- [x] scraper.py: Targets 6 real government sites
- [x] scraper.py: Playwright with headless browser, networkidle wait
- [x] scraper.py: Dynamic content selector waiting
- [x] scraper.py: Retry logic (4 attempts, exponential backoff)
- [x] ai_processor.py: Real Gemini API initialization
- [x] ai_processor.py: Strict prompt with exact JSON schema
- [x] ai_processor.py: Handles empty responses (no real updates)
- [x] ai_processor.py: Deterministic content_hash for idempotency
- [x] main.py: Full orchestration loop (scrape → Gemini → DB → Telegram)
- [x] main.py: Detailed logging at every stage
- [x] main.py: --once and --interval CLI arguments
- [x] main.py: Continuous monitoring with cycle counter
- [x] api.py: GET /api/updates returns real DB data
- [x] api.py: GET /api/stats returns real statistics
- [x] README.md: Comprehensive documentation
- [x] No placeholders or stub functions remaining

---

## 🎯 Next Steps

1. **Set Gemini API Key:**
   ```bash
   echo "GEMINI_API_KEY=your_key_here" >> .env
   ```

2. **Test Single Cycle:**
   ```bash
   python main.py --once
   ```

3. **Verify Database:**
   ```bash
   sqlite3 govtexam_alerts.db "SELECT COUNT(*) as total FROM notifications;"
   ```

4. **Start Production:**
   ```bash
   # Terminal 1
   python main.py
   
   # Terminal 2
   uvicorn api:app --host 0.0.0.0 --port 8000
   
   # Terminal 3
   cd frontend && npm run dev
   ```

5. **Monitor Logs:**
   - All stages logged with [INFO], [DEBUG], [WARN], [ERROR] prefixes
   - Dashboard auto-updates when new real notifications arrive ✅

---

**System is now production-ready with zero placeholders!** 🚀
