from __future__ import annotations

import argparse
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import List

from dotenv import load_dotenv

from ai_processor import GeminiProcessor
from database import Database, get_database
from notifier import TelegramNotifier
from scraper import GOVERNMENT_SITES, scrape_all_sites

load_dotenv()
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


class GovernmentExamUpdateAgent:
    def __init__(
        self,
        database: Database | None = None,
        processor: GeminiProcessor | None = None,
        notifier: TelegramNotifier | None = None,
    ) -> None:
        self.database = database or get_database()
        self.processor = processor or GeminiProcessor()
        self.notifier = notifier or TelegramNotifier()

    async def run_cycle(self) -> dict:
        from scraper import SiteTarget

        # Fetch custom watchlist portals from the database
        watchlist_portals = []
        try:
            watchlist_portals = self.database.list_watchlist_portals()
        except Exception as exc:
            logger.error("[ERROR] Failed to fetch watchlist: %s", exc)

        targets = list(GOVERNMENT_SITES)
        for portal in watchlist_portals:
            if not any(t.url == portal["target_url"] for t in targets):
                targets.append(SiteTarget(name=portal["website_name"], url=portal["target_url"]))

        logger.info("[INFO] ========== Starting monitoring cycle for %d sites ==========", len(targets))
        
        try:
            site_pages = await scrape_all_sites(targets)
            logger.info("[INFO] Successfully scraped %d sites out of %d", len(site_pages), len(targets))
        except Exception as exc:
            logger.error("[ERROR] Scraping phase failed: %s", exc)
            return {
                "processed_sites": 0,
                "new_notifications": 0,
                "telegram_sent": 0,
                "error": str(exc),
            }

        # Log explicit success/fail metrics for exactly all targeted sites
        success_names = {page_data["site_name"] for page_data in site_pages}
        for target in targets:
            if target.name in success_names:
                logger.info("[METRIC] Site crawl SUCCESS: %s (%s)", target.name, target.url)
            else:
                logger.error("[METRIC] Site crawl FAILED: %s (%s)", target.name, target.url)
        
        newly_saved: List[dict] = []
        
        for page_data in site_pages:
            site_name = page_data["site_name"]
            source_url = page_data["source_url"]
            raw_text = page_data["content"]
            
            logger.info("[INFO] Processing Gemini extraction for %s", site_name)
            
            try:
                parsed_updates = self.processor.parse_updates(site_name, source_url, raw_text)
                
                if not parsed_updates:
                    logger.info("[INFO] No updates extracted for %s", site_name)
                    continue
                
                logger.info("[INFO] Gemini extracted %d update(s) for %s", len(parsed_updates), site_name)
                
                for update in parsed_updates:
                    payload = update.to_dict()
                    payload.update(
                        {
                            "site_name": site_name,
                            "source_url": source_url,
                            "raw_text": raw_text,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    
                    inserted = self.database.insert_notification(payload)
                    
                    if inserted:
                        logger.info(
                            "[INFO] New notification saved: %s | %s | %s",
                            payload["exam_name"],
                            payload["update_type"],
                            payload["summary"][:80],
                        )
                        newly_saved.append(payload)
                    else:
                        logger.debug("[DEBUG] Duplicate notification skipped (idempotent): %s", payload["content_hash"][:16])
            
            except Exception as exc:
                logger.error("[ERROR] Failed to process %s: %s", site_name, exc)
                continue
        
        logger.info("[INFO] Attempting Telegram broadcast for %d new notifications", len(newly_saved))
        
        try:
            sent_hashes = await self.notifier.broadcast(newly_saved)
            logger.info("[INFO] Telegram broadcast: %d notifications sent", len(sent_hashes))
            
            for content_hash in sent_hashes:
                self.database.mark_telegram_sent(content_hash)
        except Exception as exc:
            logger.error("[ERROR] Telegram broadcast failed: %s", exc)
            sent_hashes = []
        
        stats = self.database.stats()
        result = {
            "processed_sites": len(site_pages),
            "new_notifications": len(newly_saved),
            "telegram_sent": len(sent_hashes),
            "stats": stats,
        }
        
        logger.info("[INFO] ========== Monitoring cycle completed ==========")
        logger.info("[INFO] Summary: %s", result)
        return result

    async def run_forever(self, interval_minutes: int = 30) -> None:
        interval_seconds = max(60, interval_minutes * 60)
        logger.info("[INFO] Starting continuous monitoring loop (interval: %d seconds / %d minutes)", interval_seconds, interval_minutes)
        cycle_count = 0
        
        while True:
            cycle_count += 1
            logger.info("[INFO] ===== CYCLE %d START (UTC: %s) =====", cycle_count, datetime.now(timezone.utc).isoformat())
            
            try:
                await self.run_cycle()
            except Exception as exc:
                logger.exception("[ERROR] Monitor cycle %d failed: %s", cycle_count, exc)
            
            logger.info("[INFO] ===== CYCLE %d END - Sleeping for %d seconds =====", cycle_count, interval_seconds)
            await asyncio.sleep(interval_seconds)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Government exam update tracking agent")
    parser.add_argument("--once", action="store_true", help="Run a single monitoring cycle and exit")
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.getenv("SCRAPE_INTERVAL_MINUTES", "30")),
        help="Polling interval in minutes when running continuously",
    )
    return parser.parse_args()


async def _main() -> None:
    args = parse_args()
    agent = GovernmentExamUpdateAgent()
    if args.once:
        await agent.run_cycle()
    else:
        await agent.run_forever(interval_minutes=args.interval)


if __name__ == "__main__":
    asyncio.run(_main())
