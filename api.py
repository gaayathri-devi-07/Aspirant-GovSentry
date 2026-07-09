from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, validator

from database import VALID_USER_STATUSES, get_database

load_dotenv()

database = get_database()

app = FastAPI(
    title="Government Exam Update API",
    version="2.0.0",
    description="Reads the notifications table and serves the latest exam updates, with full watchlist management.",
)

# ---------------------------------------------------------------------------
# CORS — explicitly allow localhost:3000 and 127.0.0.1:3000 with credentials
# ---------------------------------------------------------------------------
allowed_origins: List[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

_raw_origins = os.getenv("ALLOWED_ORIGINS")
if _raw_origins:
    for origin in _raw_origins.split(","):
        stripped = origin.strip()
        if stripped and stripped not in allowed_origins:
            allowed_origins.append(stripped)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class WatchlistCreatePayload(BaseModel):
    website_name: str
    target_url: str

    @validator("website_name")
    def name_not_empty(cls, value: str) -> str:  # noqa: N805
        value = value.strip()
        if not value:
            raise ValueError("website_name must not be empty.")
        return value

    @validator("target_url")
    def url_not_empty(cls, value: str) -> str:  # noqa: N805
        value = value.strip()
        if not value:
            raise ValueError("target_url must not be empty.")
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("target_url must be a valid HTTP or HTTPS URL.")
        return value


class StatusUpdatePayload(BaseModel):
    user_status: str

    @validator("user_status")
    def validate_status(cls, value: str) -> str:  # noqa: N805
        value = value.strip()
        if value not in VALID_USER_STATUSES:
            raise ValueError(
                f"user_status must be one of: {', '.join(sorted(VALID_USER_STATUSES))}"
            )
        return value


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_serialize(update: Any) -> Dict[str, Any]:
    """Convert any database row representation to a plain dict."""
    if hasattr(update, "to_dict"):
        return update.to_dict()
    if isinstance(update, dict):
        return update
    if hasattr(update, "__dict__"):
        return {k: v for k, v in update.__dict__.items() if not k.startswith("_")}
    try:
        return dict(update)
    except Exception:
        return {"raw": str(update)}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/updates")
async def get_updates() -> Dict[str, Any]:
    """Return the latest 50 exam update notifications from the database."""
    raw_updates = database.latest_notifications(limit=50)

    serialized_updates: List[Dict[str, Any]] = []
    for update in raw_updates:
        entry = _safe_serialize(update)
        serialized_updates.append(entry)

    return {
        "count": len(serialized_updates),
        "updates": serialized_updates,
    }


@app.get("/api/stats")
async def get_stats() -> Dict[str, Any]:
    """Return dashboard statistics with both snake_case and camelCase keys
    to guarantee frontend compatibility regardless of key convention used."""
    raw_stats = database.stats()
    stats_dict: Dict[str, Any] = _safe_serialize(raw_stats) if not isinstance(raw_stats, dict) else raw_stats

    # Extract values with dual-key fallbacks
    total_alerts: int = int(
        stats_dict.get("total_alerts", stats_dict.get("totalAlerts", 0)) or 0
    )
    # active_monitors now comes directly from database.stats() as the sum of
    # distinct portal site_names + custom watchlist entries.
    active_monitors: int = int(
        stats_dict.get("active_monitors", stats_dict.get("activeMonitors", 0)) or 0
    )
    total_sites: int = int(stats_dict.get("total_sites", 0) or 0)
    default_portals: int = int(
        stats_dict.get("default_portals", stats_dict.get("defaultPortals", 6)) or 6
    )
    telegram_sent: int = int(stats_dict.get("telegram_sent", 0) or 0)
    watchlist_count: int = int(stats_dict.get("watchlist_count", 0) or 0)
    last_sync: Optional[str] = stats_dict.get("last_sync") or stats_dict.get("lastSync")

    # Return both camelCase AND snake_case concurrently to eliminate any
    # "undefined / 0" failures caused by key-convention mismatches on the frontend.
    return {
        "totalAlerts": total_alerts,
        "total_alerts": total_alerts,
        "activeMonitors": active_monitors,
        "active_monitors": active_monitors,
        "totalSites": total_sites,
        "total_sites": total_sites,
        "defaultPortals": default_portals,
        "default_portals": default_portals,
        "telegramSent": telegram_sent,
        "telegram_sent": telegram_sent,
        "watchlistCount": watchlist_count,
        "watchlist_count": watchlist_count,
        "lastSync": last_sync,
        "last_sync": last_sync,
    }


# ---------------------------------------------------------------------------
# CRM Status endpoint
# ---------------------------------------------------------------------------

@app.put("/api/update-status/{alert_id}", status_code=status.HTTP_200_OK)
async def update_alert_status(alert_id: int, payload: StatusUpdatePayload) -> Dict[str, Any]:
    """Update the CRM user_status for a single notification by its integer id."""
    try:
        updated = database.update_user_status(alert_id, payload.user_status)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with id={alert_id} was not found.",
        )
    return {"message": "Status updated.", "alert": updated}


# ---------------------------------------------------------------------------
# Watchlist endpoints
# ---------------------------------------------------------------------------

@app.get("/api/watchlist")
async def list_watchlist() -> Dict[str, Any]:
    """Return all custom watchlist portals stored in the database."""
    portals = database.list_watchlist_portals()
    return {"count": len(portals), "portals": portals}


@app.post("/api/watchlist", status_code=status.HTTP_201_CREATED)
async def create_watchlist_portal(payload: WatchlistCreatePayload) -> Dict[str, Any]:
    """Persist a new custom portal to the watchlist table."""
    try:
        created = database.insert_watchlist_portal(
            website_name=payload.website_name,
            target_url=payload.target_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"message": "Portal added to watchlist.", "portal": created}


@app.post("/api/track-url", status_code=status.HTTP_201_CREATED)
async def track_url(payload: WatchlistCreatePayload) -> Dict[str, Any]:
    """Persist a new custom portal to the watchlist table (alias track-url)."""
    try:
        created = database.insert_watchlist_portal(
            website_name=payload.website_name,
            target_url=payload.target_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return {"message": "Portal added to watchlist.", "portal": created}


@app.delete("/api/watchlist/{portal_id}", status_code=status.HTTP_200_OK)
async def delete_watchlist_portal(portal_id: int) -> Dict[str, Any]:
    """Remove a custom portal from the watchlist by its integer id."""
    deleted = database.delete_watchlist_portal(portal_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Watchlist portal with id={portal_id} was not found.",
        )
    return {"message": f"Portal id={portal_id} removed from watchlist."}


@app.get("/api/watchlist/{portal_id}")
async def get_watchlist_portal(portal_id: int) -> Dict[str, Any]:
    """Fetch a single watchlist portal entry by id."""
    portal = database.get_watchlist_portal(portal_id)
    if portal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Watchlist portal with id={portal_id} was not found.",
        )
    return portal


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}