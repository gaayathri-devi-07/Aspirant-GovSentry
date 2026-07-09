from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional

DEFAULT_DB_PATH = os.getenv("DATABASE_PATH", "govtexam_alerts.db")

# Global connection for in-memory test database (keeps it alive)
_MEMORY_DB_CONNECTION: sqlite3.Connection | None = None


@dataclass(slots=True)
class NotificationRecord:
    exam_name: str
    update_type: str
    old_value: str
    new_value: str
    summary: str
    source_url: str
    site_name: str
    raw_text: str
    content_hash: str
    created_at: str
    telegram_sent: int = 0

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["telegram_sent"] = bool(self.telegram_sent)
        return payload


@dataclass(slots=True)
class WatchlistRecord:
    id: int
    website_name: str
    target_url: str
    synced: bool
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "website_name": self.website_name,
            "target_url": self.target_url,
            "synced": self.synced,
            "created_at": self.created_at,
        }


def classify_headline_category(exam_name: str, summary: str, current_tag: str = "") -> str:
    combined = f"{exam_name} {summary} {current_tag}".lower()
    if "result" in combined or "score" in combined or "merit" in combined or "selected" in combined:
        return "🏆 Final Result"
    elif "admit" in combined or "call letter" in combined or "hall ticket" in combined:
        return "🎫 Admit Card"
    elif "date" in combined or "schedule" in combined or "postpone" in combined or "reschedule" in combined:
        return "📅 Exam Date"
    else:
        return "📢 Notification"


class Database:
    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or DEFAULT_DB_PATH
        # Don't try to create directories for in-memory databases
        if self.db_path != ':memory:':
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        global _MEMORY_DB_CONNECTION

        # For in-memory databases during testing, use a shared connection
        if self.db_path == ':memory:':
            if _MEMORY_DB_CONNECTION is None:
                _MEMORY_DB_CONNECTION = sqlite3.connect(':memory:', check_same_thread=False)
                _MEMORY_DB_CONNECTION.row_factory = sqlite3.Row
                _MEMORY_DB_CONNECTION.execute("PRAGMA synchronous=NORMAL")
                _MEMORY_DB_CONNECTION.execute("PRAGMA foreign_keys=ON")
            return _MEMORY_DB_CONNECTION
        else:
            connection = sqlite3.connect(self.db_path, check_same_thread=False)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.execute("PRAGMA foreign_keys=ON")
            return connection

    def _initialize(self) -> None:
        connection = self._connect()
        try:
            # --- Notifications table ---
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    exam_name TEXT NOT NULL,
                    update_type TEXT NOT NULL,
                    old_value TEXT NOT NULL,
                    new_value TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    site_name TEXT NOT NULL,
                    raw_text TEXT NOT NULL,
                    content_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    telegram_sent INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_notifications_site_name ON notifications(site_name)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_notifications_exam_name ON notifications(exam_name)"
            )
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency ON notifications(content_hash)"
            )

            # --- Watchlist table ---
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS watchlist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    website_name TEXT NOT NULL,
                    target_url TEXT NOT NULL UNIQUE,
                    synced INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_watchlist_created_at ON watchlist(created_at DESC)"
            )
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_url ON watchlist(target_url)"
            )

            connection.commit()

            # --- Check record count and seed if fewer than 5 records (skip in-memory test databases) ---
            if self.db_path != ':memory:':
                cursor = connection.execute("SELECT COUNT(*) AS total FROM notifications")
                row = cursor.fetchone()
                if row is not None and row["total"] < 5:
                    self._seed_data(connection)

        finally:
            # Don't close in-memory connections - they're shared
            if self.db_path != ':memory:':
                connection.close()

    def _seed_data(self, connection: sqlite3.Connection) -> None:
        import hashlib
        from datetime import datetime, timedelta, timezone

        seeds = [
            {
                "site_name": "Union Public Service Commission",
                "exam_name": "Civil Services (Preliminary) Examination, 2026",
                "update_type": "Admit Card Release",
                "old_value": "To Be Released",
                "new_value": "e-Admit Card Available for Download",
                "summary": "The Union Public Service Commission has released the e-Admit Card for the Civil Services (Preliminary) Examination, 2026. Candidates are advised to download their admit cards and check the exam venue details immediately.",
                "source_url": "https://upsc.gov.in/whats-new/civil-services-preliminary-examination-2026/admit-card",
                "day_offset": 1
            },
            {
                "site_name": "Staff Selection Commission",
                "exam_name": "Combined Graduate Level Examination, 2026",
                "update_type": "General Notification",
                "old_value": "TBD",
                "new_value": "Official Notification Released",
                "summary": "Staff Selection Commission has published the detailed notification for Combined Graduate Level Examination (CGL) 2026. Online registration commences today. Eligible graduates can apply through the new official portal ssc.gov.in.",
                "source_url": "https://ssc.gov.in/candidate-portal/notifications/cgl-2026-announcement",
                "day_offset": 2
            },
            {
                "site_name": "Tamil Nadu Public Service Commission",
                "exam_name": "Combined Civil Services Examination - IV (Group 4)",
                "update_type": "Results",
                "old_value": "Pending",
                "new_value": "Written Exam Results Declared",
                "summary": "Tamil Nadu Public Service Commission has announced the results and marks obtained by candidates in the Combined Civil Services Examination - IV (Group 4). Candidates can check their rank positions and certificate upload schedule.",
                "source_url": "https://tnpsc.gov.in/results/group-4-services-results-2026",
                "day_offset": 3
            },
            {
                "site_name": "Railway Recruitment Board Chandigarh",
                "exam_name": "Non-Technical Popular Categories (NTPC) Graduate & Under Graduate",
                "update_type": "Exam Dates",
                "old_value": "Postponed",
                "new_value": "CBT Phase 1 Scheduled from July 28, 2026",
                "summary": "Railway Recruitment Board (RRB) has released the computer-based test (CBT-1) schedule for the NTPC recruitment. City intimation links will be activated 10 days prior to the respective exam dates.",
                "source_url": "https://www.rrbcdg.gov.in/news/ntpc-cbt-1-schedule-details",
                "day_offset": 4
            },
            {
                "site_name": "Institute of Banking Personnel Selection",
                "exam_name": "Common Recruitment Process for Probationary Officers (CRP PO/MT-XVI)",
                "update_type": "Admit Card Release",
                "old_value": "Not Available",
                "new_value": "Preliminary Online Exam Call Letter Out",
                "summary": "IBPS has activated the download link for the Preliminary Exam Call Letter for CRP PO/MT-XVI. Candidates need their registration number and password/date of birth to access the document.",
                "source_url": "https://www.ibps.in/crp-po-mt-xvi/prelims-call-letter",
                "day_offset": 5
            },
            {
                "site_name": "National Testing Agency",
                "exam_name": "Joint Entrance Examination (JEE) Main - Session 2",
                "update_type": "Answer Key",
                "old_value": "Not Released",
                "new_value": "Provisional Answer Key & Response Sheet Out",
                "summary": "NTA has uploaded the provisional answer keys along with the recorded responses of JEE Main 2026 Session 2 on the official portal. Candidates can submit key challenges up to the designated window.",
                "source_url": "https://nta.ac.in/jee-main/session-2-answer-key-objections",
                "day_offset": 6
            },
            {
                "site_name": "Union Public Service Commission",
                "exam_name": "National Defence Academy & Naval Academy Examination (I), 2026",
                "update_type": "Results",
                "old_value": "Under Process",
                "new_value": "Written Exam Results Declared",
                "summary": "The UPSC has announced the roll number list of candidates who have qualified for the Services Selection Board (SSB) interview based on the NDA/NA (I) written examination held recently.",
                "source_url": "https://upsc.gov.in/whats-new/nda-na-i-examination-2026/written-results",
                "day_offset": 7
            },
            {
                "site_name": "Staff Selection Commission",
                "exam_name": "Combined Higher Secondary (10+2) Level Examination, 2026",
                "update_type": "Admit Card Release",
                "old_value": "Under Preparation",
                "new_value": "Tier-I Status and Admit Card Released",
                "summary": "Staff Selection Commission has uploaded the application status and admission certificate downloads for the CHSL (10+2) Tier-I exam for various regions. Check regional sites for specific downloads.",
                "source_url": "https://ssc.gov.in/candidate-portal/notifications/chsl-tier-1-admit-cards",
                "day_offset": 9
            },
            {
                "site_name": "Tamil Nadu Public Service Commission",
                "exam_name": "Combined Civil Services Examination - II (Group 2 & 2A)",
                "update_type": "Answer Key",
                "old_value": "TBA",
                "new_value": "Tentative Answer Keys Published",
                "summary": "TNPSC has released the tentative answer keys for the CCSE-II (Group 2 and 2A) preliminary exam. Candidates can submit representations challenging the answer keys via the online utility.",
                "source_url": "https://tnpsc.gov.in/answer-keys/group-2-prelims-tentative-keys-2026",
                "day_offset": 10
            },
            {
                "site_name": "Railway Recruitment Board Chandigarh",
                "exam_name": "Assistant Loco Pilot (ALP) Recruitment 2026",
                "update_type": "Results",
                "old_value": "Awaiting Evaluation",
                "new_value": "CBT-1 Shortlisted Candidates for CBT-2 Released",
                "summary": "Railway Recruitment Boards have announced the list of candidates shortlisted for the Second Stage CBT (CBT-2) for ALP recruitment. Cut-off scores for all participating railway zones are published.",
                "source_url": "https://www.rrbcdg.gov.in/results/alp-cbt-1-shortlist-results",
                "day_offset": 11
            },
            {
                "site_name": "Institute of Banking Personnel Selection",
                "exam_name": "Common Recruitment Process for Clerk (CRP Clerks-XVI)",
                "update_type": "Results",
                "old_value": "Awaiting",
                "new_value": "Online Preliminary Exam Results Declared",
                "summary": "IBPS has declared the result status of the Online Preliminary Examination for CRP Clerks-XVI. Candidates can view their qualification status for the Main Examination on the official portal.",
                "source_url": "https://www.ibps.in/crp-clerk-xvi/prelims-results-status",
                "day_offset": 13
            },
            {
                "site_name": "National Testing Agency",
                "exam_name": "National Eligibility cum Entrance Test (NEET) UG - 2026",
                "update_type": "General Notification",
                "old_value": "Closed",
                "new_value": "Online Application Registration Date Extended",
                "summary": "In response to representations from student groups, NTA has extended the registration deadline for NEET UG 2026. The new deadline allows candidates to submit applications and pay fees.",
                "source_url": "https://nta.ac.in/neet-ug/registration-extension-2026",
                "day_offset": 14
            },
            {
                "site_name": "Union Public Service Commission",
                "exam_name": "Combined Medical Services Examination, 2026",
                "update_type": "Exam Dates",
                "old_value": "Tentative",
                "new_value": "Official Examination Schedule Finalised",
                "summary": "The UPSC has finalized and published the detailed timetable for the Combined Medical Services Examination 2026. The examination is scheduled to be conducted on July 19, 2026, across multiple sessions.",
                "source_url": "https://upsc.gov.in/whats-new/cms-examination-2026/exam-schedule",
                "day_offset": 15
            },
            {
                "site_name": "Staff Selection Commission",
                "exam_name": "Multi Tasking (Non-Technical) Staff Examination, 2026",
                "update_type": "Exam Dates",
                "old_value": "October 2026",
                "new_value": "Detailed Exam Schedule Out (Sept 5 to Sept 25)",
                "summary": "Staff Selection Commission has announced the revised examination dates for the Multi Tasking Staff (MTS) Exam 2026. The CBT will take place in multiple shifts across the country starting September 5.",
                "source_url": "https://ssc.gov.in/candidate-portal/notifications/mts-2026-exam-schedule",
                "day_offset": 16
            },
            {
                "site_name": "Tamil Nadu Public Service Commission",
                "exam_name": "Combined Engineering Subordinate Services Exam",
                "update_type": "General Notification",
                "old_value": "Draft Status",
                "new_value": "Official Notification & Online Application Started",
                "summary": "Tamil Nadu Public Service Commission invites online applications for direct recruitment to various posts in the Combined Engineering Subordinate Services. Register via TNPSC One Time Registration.",
                "source_url": "https://tnpsc.gov.in/notifications/engineering-subordinate-services-2026",
                "day_offset": 17
            },
            {
                "site_name": "Railway Recruitment Board Chandigarh",
                "exam_name": "Recruitment of Sub-Inspectors & Constables in RPF",
                "update_type": "General Notification",
                "old_value": "Proposed",
                "new_value": "Detailed Employment Notice Published",
                "summary": "RPF Recruitment Cell under Railway Boards has released the detailed notification for recruitment of Sub-Inspectors and Constables. Online application link is active on RRB websites.",
                "source_url": "https://www.rrbcdg.gov.in/news/rpf-recruitment-notice-2026",
                "day_offset": 18
            },
            {
                "site_name": "Institute of Banking Personnel Selection",
                "exam_name": "Common Recruitment Process for Specialist Officers (CRP SPL-XVI)",
                "update_type": "General Notification",
                "old_value": "TBA",
                "new_value": "Detailed Advertisement Released",
                "summary": "IBPS has released the official brochure and job requirements for CRP Specialist Officers. Recruitments cover IT Officer, Agricultural Field Officer, Rajbhasha Adhikari, Law Officer, HR and Marketing.",
                "source_url": "https://www.ibps.in/crp-spl-xvi/recruitment-details",
                "day_offset": 19
            },
            {
                "site_name": "National Testing Agency",
                "exam_name": "UGC National Eligibility Test (NET) - June 2026",
                "update_type": "Answer Key",
                "old_value": "Not Available",
                "new_value": "Provisional Keys and Objection Window Active",
                "summary": "NTA has released the provisional answer keys for UGC NET June 2026. Candidates who appeared for the exam can raise objections online by submitting fee payments for each contested answer.",
                "source_url": "https://nta.ac.in/ugc-net/june-2026-provisional-keys",
                "day_offset": 20
            }
        ]

        base_time = datetime.now(timezone.utc)

        for item in seeds:
            category_tag = classify_headline_category(item["exam_name"], item["summary"], item["update_type"])
            created_at = (base_time - timedelta(days=item["day_offset"])).isoformat()

            fingerprint = json.dumps(
                {
                    "site_name": item["site_name"],
                    "source_url": item["source_url"],
                    "exam_name": item["exam_name"],
                    "update_type": category_tag,
                    "old_value": item["old_value"],
                    "new_value": item["new_value"],
                    "summary": item["summary"],
                },
                sort_keys=True,
                ensure_ascii=True,
            )
            content_hash = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()

            connection.execute(
                """
                INSERT OR IGNORE INTO notifications (
                    exam_name, update_type, old_value, new_value, summary,
                    source_url, site_name, raw_text, content_hash, created_at, telegram_sent
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["exam_name"],
                    category_tag,
                    item["old_value"],
                    item["new_value"],
                    item["summary"],
                    item["source_url"],
                    item["site_name"],
                    "MOCK DATA SEED",
                    content_hash,
                    created_at,
                    1,
                ),
            )
        connection.commit()

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> NotificationRecord:
        return NotificationRecord(
            exam_name=row["exam_name"],
            update_type=row["update_type"],
            old_value=row["old_value"],
            new_value=row["new_value"],
            summary=row["summary"],
            source_url=row["source_url"],
            site_name=row["site_name"],
            raw_text=row["raw_text"],
            content_hash=row["content_hash"],
            created_at=row["created_at"],
            telegram_sent=row["telegram_sent"],
        )

    @staticmethod
    def _row_to_watchlist_record(row: sqlite3.Row) -> WatchlistRecord:
        return WatchlistRecord(
            id=row["id"],
            website_name=row["website_name"],
            target_url=row["target_url"],
            synced=bool(row["synced"]),
            created_at=row["created_at"],
        )

    def insert_notification(self, payload: Dict[str, Any]) -> bool:
        created_at = payload.get("created_at") or datetime.now(timezone.utc).isoformat()
        raw_update_type = payload.get("update_type", "").strip()
        standardized_category = classify_headline_category(
            payload["exam_name"], payload.get("summary", ""), raw_update_type
        )
        data = {
            "exam_name": payload["exam_name"].strip(),
            "update_type": standardized_category,
            "old_value": payload.get("old_value", "").strip(),
            "new_value": payload.get("new_value", "").strip(),
            "summary": payload.get("summary", "").strip(),
            "source_url": payload.get("source_url", "").strip(),
            "site_name": payload.get("site_name", "").strip(),
            "raw_text": payload.get("raw_text", "").strip(),
            "content_hash": payload["content_hash"].strip(),
            "created_at": created_at,
            "telegram_sent": int(bool(payload.get("telegram_sent", False))),
        }

        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO notifications (
                    exam_name, update_type, old_value, new_value, summary,
                    source_url, site_name, raw_text, content_hash, created_at, telegram_sent
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data["exam_name"],
                    data["update_type"],
                    data["old_value"],
                    data["new_value"],
                    data["summary"],
                    data["source_url"],
                    data["site_name"],
                    data["raw_text"],
                    data["content_hash"],
                    data["created_at"],
                    data["telegram_sent"],
                ),
            )
            connection.commit()
            return cursor.rowcount == 1

    def mark_telegram_sent(self, content_hash: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE notifications SET telegram_sent = 1 WHERE content_hash = ?",
                (content_hash,),
            )
            connection.commit()

    def latest_notifications(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, exam_name, update_type, old_value, new_value, summary,
                       source_url, site_name, raw_text, content_hash, created_at, telegram_sent
                FROM notifications
                ORDER BY datetime(created_at) DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        result = []
        for row in rows:
            record = self._row_to_record(row)
            entry = record.to_dict()
            # Inject the integer primary key so the frontend has a stable id field
            entry["id"] = row["id"]
            result.append(entry)
        return result

    def stats(self) -> Dict[str, Any]:
        with self._connect() as connection:
            total_alerts = connection.execute("SELECT COUNT(*) AS total FROM notifications").fetchone()["total"]
            total_sites = connection.execute(
                "SELECT COUNT(DISTINCT site_name) AS total FROM notifications"
            ).fetchone()["total"]
            last_sync = connection.execute(
                "SELECT MAX(created_at) AS last_sync FROM notifications"
            ).fetchone()["last_sync"]
            telegram_sent = connection.execute(
                "SELECT COUNT(*) AS total FROM notifications WHERE telegram_sent = 1"
            ).fetchone()["total"]
            watchlist_count = connection.execute(
                "SELECT COUNT(*) AS total FROM watchlist"
            ).fetchone()["total"]
        # active_monitors = distinct portals from notifications + custom watchlist entries
        active_monitors = total_sites + watchlist_count
        return {
            "total_alerts": total_alerts,
            "total_sites": total_sites,
            "telegram_sent": telegram_sent,
            "last_sync": last_sync,
            "active_monitors": active_monitors,
            "watchlist_count": watchlist_count,
        }

    def pending_telegram_notifications(self, limit: int = 20) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, exam_name, update_type, old_value, new_value, summary,
                       source_url, site_name, raw_text, content_hash, created_at, telegram_sent
                FROM notifications
                WHERE telegram_sent = 0
                ORDER BY datetime(created_at) DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        result = []
        for row in rows:
            record = self._row_to_record(row)
            entry = record.to_dict()
            entry["id"] = row["id"]
            result.append(entry)
        return result

    # ------------------------------------------------------------------
    # Watchlist CRUD
    # ------------------------------------------------------------------

    def insert_watchlist_portal(self, website_name: str, target_url: str) -> Dict[str, Any]:
        """Insert a new watchlist portal. Returns the created record dict.

        Raises ValueError if target_url is already tracked.
        """
        created_at = datetime.now(timezone.utc).isoformat()
        website_name = website_name.strip()
        target_url = target_url.strip()

        connection = self._connect()
        try:
            cursor = connection.execute(
                """
                INSERT INTO watchlist (website_name, target_url, synced, created_at)
                VALUES (?, ?, 1, ?)
                """,
                (website_name, target_url, created_at),
            )
            connection.commit()
            new_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            raise ValueError(f"Portal URL already exists in watchlist: {target_url}")
        finally:
            if self.db_path != ':memory:':
                connection.close()

        return WatchlistRecord(
            id=new_id,
            website_name=website_name,
            target_url=target_url,
            synced=True,
            created_at=created_at,
        ).to_dict()

    def list_watchlist_portals(self) -> List[Dict[str, Any]]:
        """Return all watchlist portals ordered by most-recently added first."""
        connection = self._connect()
        try:
            rows = connection.execute(
                """
                SELECT id, website_name, target_url, synced, created_at
                FROM watchlist
                ORDER BY datetime(created_at) DESC, id DESC
                """
            ).fetchall()
        finally:
            if self.db_path != ':memory:':
                connection.close()
        return [self._row_to_watchlist_record(row).to_dict() for row in rows]

    def delete_watchlist_portal(self, portal_id: int) -> bool:
        """Delete a watchlist portal by its integer primary key.

        Returns True if a row was deleted, False if the id was not found.
        """
        connection = self._connect()
        try:
            cursor = connection.execute(
                "DELETE FROM watchlist WHERE id = ?",
                (portal_id,),
            )
            connection.commit()
            return cursor.rowcount == 1
        finally:
            if self.db_path != ':memory:':
                connection.close()

    def get_watchlist_portal(self, portal_id: int) -> Optional[Dict[str, Any]]:
        """Fetch a single watchlist portal by id. Returns None if not found."""
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT id, website_name, target_url, synced, created_at FROM watchlist WHERE id = ?",
                (portal_id,),
            ).fetchone()
        finally:
            if self.db_path != ':memory:':
                connection.close()
        if row is None:
            return None
        return self._row_to_watchlist_record(row).to_dict()


def get_database(db_path: str | None = None) -> Database:
    return Database(db_path=db_path)
