from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from telegram import Bot

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class TelegramConfig:
    token: str
    chat_id: str

    @property
    def enabled(self) -> bool:
        return bool(self.token and self.chat_id)


class TelegramNotifier:
    def __init__(self, token: str | None = None, chat_id: str | None = None) -> None:
        self.config = TelegramConfig(
            token=(token or os.getenv("TELEGRAM_BOT_TOKEN", "")).strip(),
            chat_id=(chat_id or os.getenv("TELEGRAM_CHAT_ID", "")).strip(),
        )

    @staticmethod
    def format_message(notification: Dict[str, Any]) -> str:
        exam_name = notification.get("exam_name", "Government Exam Update")
        update_type = notification.get("update_type", "Update")
        summary = notification.get("summary", "")
        old_value = notification.get("old_value", "")
        new_value = notification.get("new_value", "")
        source_url = notification.get("source_url", "")
        site_name = notification.get("site_name", "")

        body_lines = [
            f"<b>{exam_name}</b>",
            f"<i>{update_type}</i>",
        ]
        if site_name:
            body_lines.append(f"Source: {site_name}")
        if summary:
            body_lines.append(summary)
        if old_value:
            body_lines.append(f"Previous: {old_value}")
        if new_value:
            body_lines.append(f"Current: {new_value}")
        if source_url:
            body_lines.append(f"Link: {source_url}")
        return "\n".join(body_lines)

    async def send_update(self, notification: Dict[str, Any]) -> bool:
        if not self.config.enabled:
            logger.info("Telegram is disabled or not configured; skipping notification broadcast.")
            return False

        message = self.format_message(notification)
        bot = Bot(token=self.config.token)
        try:
            await bot.send_message(
                chat_id=self.config.chat_id,
                text=message,
                parse_mode="HTML",
                disable_web_page_preview=False,
            )
            return True
        except Exception as exc:
            logger.exception("Failed to send Telegram notification: %s", exc)
            return False

    async def broadcast(self, notifications: Iterable[Dict[str, Any]]) -> list[str]:
        sent_hashes: list[str] = []
        for notification in notifications:
            if await self.send_update(notification):
                content_hash = str(notification.get("content_hash", "")).strip()
                if content_hash:
                    sent_hashes.append(content_hash)
        return sent_hashes
