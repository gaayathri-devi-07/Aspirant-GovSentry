from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

from playwright.async_api import Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError, async_playwright

logger = logging.getLogger(__name__)


def extract_tldr_metadata(text: str) -> Dict[str, Optional[str]]:
    """Extract Fee, Vacancies, and Last Date from notification body text."""
    if not text or not text.strip():
        return {"fee": None, "vacancies": None, "last_date": None}

    normalized = re.sub(r"\s+", " ", text.strip())

    fee: Optional[str] = None
    fee_patterns = [
        r"(?:application\s+)?fee[:\s]*(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)",
        r"(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)(?:\s*(?:\(?(?:application|exam)\s+fee\)?))?",
        r"fee[:\s]*([\d,]+)\s*(?:\/-)?"
    ]
    for pattern in fee_patterns:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            fee = f"₹{match.group(1).replace(',', '')}"
            break

    vacancies: Optional[str] = None
    vacancy_patterns = [
        r"(\d[\d,]*)\s*(?:posts?|vacancies|vacancy|positions?)",
        r"(?:total|number\s+of)\s*(?:posts?|vacancies)[:\s]*(\d[\d,]*)",
    ]
    for pattern in vacancy_patterns:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            vacancies = match.group(1).replace(",", "")
            break

    last_date: Optional[str] = None
    last_date_patterns = [
        r"(?:deadline|apply\s+by|last\s+date(?:\s+to\s+apply)?|closing\s+date)[:\s]*"
        r"(\d{1,2}[-./]\d{1,2}[-./]\d{2,4})",
        r"(?:deadline|apply\s+by|last\s+date(?:\s+to\s+apply)?|closing\s+date)[:\s]*"
        r"((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
        r"Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
        r"\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})",
        r"(?:deadline|apply\s+by|last\s+date)[:\s]*(\d{4}-\d{2}-\d{2})",
    ]
    for pattern in last_date_patterns:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            last_date = match.group(1).strip()
            break

    return {"fee": fee, "vacancies": vacancies, "last_date": last_date}


# ---------------------------------------------------------------------------
# Stealth browser configuration constants
# ---------------------------------------------------------------------------

STEALTH_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

STEALTH_EXTRA_HEADERS: Dict[str, str] = {
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

STEALTH_LAUNCH_ARGS: List[str] = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-infobars",
    "--disable-setuid-sandbox",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,900",
]

# ---------------------------------------------------------------------------
# Navigation noise blacklist — skip links whose text matches these phrases
# ---------------------------------------------------------------------------

NAV_BLACKLIST_PHRASES = [
    "home", "about us", "about", "contact us", "contact", "rti",
    "tender", "tenders", "downloads", "sitemap", "helpdesk",
    "skip to main content", "skip to content", "feedback", "terms",
    "privacy policy", "disclaimer", "careers", "accessibility",
    "screen reader", "site map", "login", "register", "sign in",
    "sign up", "logout", "faq", "gallery", "media", "press",
    "recruitment rules", "vision", "mission", "annual report",
    "organization", "organisational", "minister", "ministry",
    "secretary", "director", "committee", "board",
    "advertisement", "vendor", "empanelment",
]

ANNOUNCEMENT_KEYWORDS = [
    "notification", "notice", "result", "results", "recruitment", "exam",
    "examination", "admit card", "call letter", "schedule", "syllabus",
    "interview", "answer key", "cut off", "cutoff", "merit list",
    "shortlist", "selection", "appointment", "vacancy", "vacancies",
    "application", "registration", "apply", "date", "postpone",
    "reschedule", "extension", "hall ticket", "score card", "marks",
    "provisional", "final", "declaration", "announcement",
]


# ---------------------------------------------------------------------------
# Site targets
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class SiteTarget:
    name: str
    url: str


GOVERNMENT_SITES: List[SiteTarget] = [
    SiteTarget(name="Staff Selection Commission", url="https://ssc.gov.in/"),
    SiteTarget(name="Tamil Nadu Public Service Commission", url="https://tnpsc.gov.in/"),
    SiteTarget(name="Union Public Service Commission", url="https://upsc.gov.in/"),
    SiteTarget(name="Institute of Banking Personnel Selection", url="https://www.ibps.in/"),
    SiteTarget(name="National Testing Agency", url="https://nta.ac.in/"),
    SiteTarget(name="Railway Recruitment Board Chandigarh", url="https://www.rrbcdg.gov.in/"),
]


class ScraperError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _sleep_with_backoff(attempt: int, base_delay: float = 1.25, max_delay: float = 15.0) -> None:
    """Exponential back-off with ±15% jitter so retry bursts don't align."""
    delay = min(max_delay, base_delay * (2 ** attempt))
    jitter = delay * 0.15
    await asyncio.sleep(delay + jitter)


def _is_nav_noise(text: str) -> bool:
    """Return True if the link text is navigation boilerplate and should be excluded."""
    if not text:
        return True
    text_lower = text.lower().strip()
    # Exact match or contained as the entire token
    for phrase in NAV_BLACKLIST_PHRASES:
        if text_lower == phrase or text_lower.startswith(phrase + " ") or text_lower.endswith(" " + phrase):
            return True
        if f" {phrase} " in f" {text_lower} ":
            return True
    return False


def _has_announcement_keyword(text: str) -> bool:
    """Return True if text contains at least one exam/recruitment keyword."""
    text_lower = text.lower()
    return any(kw in text_lower for kw in ANNOUNCEMENT_KEYWORDS)


def _clean_text(text: str) -> str:
    """Normalize whitespace and strip trailing/leading junk from link text."""
    # Replace tabs, newlines, multiple spaces with single space
    cleaned = re.sub(r"[\t\n\r]+", " ", text)
    cleaned = re.sub(r" {2,}", " ", cleaned)
    return cleaned.strip()


async def _extract_announcement_links(page: Page, base_url: str) -> List[Dict[str, str]]:
    """
    Extract genuine announcement links from the page by iterating <a> tags.

    Strategy:
    1. Target common announcement containers first (notice boards, update sections).
    2. Fall back to scanning all <a> tags on the page.
    3. Apply blacklist filtering and keyword matching.
    4. Resolve relative hrefs to absolute URLs using urljoin.
    5. Return list of {text, url} dicts capped at 20 items.
    """
    raw_links: List[Dict[str, str]] = await page.evaluate(
        """
        (baseUrl) => {
            const results = [];

            // Priority 1: Look inside known announcement/notice containers
            const containerSelectors = [
                "div[class*='notice']", "div[class*='Notice']",
                "div[class*='notification']", "div[class*='update']",
                "div[class*='news']", "div[class*='whats-new']",
                "div[class*='whatsnew']", "div[class*='latest']",
                "ul[class*='notice']", "ul[class*='news']",
                "ul[class*='update']", "ul[class*='latest']",
                "section[class*='notice']", "section[class*='news']",
                "table[class*='notice']", "table[class*='update']",
                ".marquee", ".ticker", "#whatsnew", "#latest-news",
                "#notification", "#notice-board",
            ];

            const seenHrefs = new Set();

            for (const sel of containerSelectors) {
                const containers = document.querySelectorAll(sel);
                for (const container of containers) {
                    const anchors = container.querySelectorAll('a[href]');
                    for (const a of anchors) {
                        const text = a.innerText.replace(/\\s+/g, ' ').trim();
                        const href = a.href || '';
                        if (text && href && !seenHrefs.has(href)) {
                            seenHrefs.add(href);
                            results.push({ text, href });
                        }
                    }
                }
            }

            // Priority 2: Fallback — scan all <a> tags if containers gave nothing useful
            if (results.length < 3) {
                const allAnchors = document.querySelectorAll('a[href]');
                for (const a of allAnchors) {
                    const text = a.innerText.replace(/\\s+/g, ' ').trim();
                    const href = a.href || '';
                    if (text && href && !seenHrefs.has(href)) {
                        seenHrefs.add(href);
                        results.push({ text, href });
                    }
                }
            }

            return results.slice(0, 200);
        }
        """,
        base_url,
    )

    announcements: List[Dict[str, str]] = []

    for link in raw_links:
        raw_text = _clean_text(link.get("text", ""))
        raw_href = link.get("href", "").strip()

        # Length guard — must be a real headline (>20 chars)
        if len(raw_text) < 20:
            continue

        # Too long is likely a paragraph, not a title
        if len(raw_text) > 350:
            continue

        # Skip navigation boilerplate
        if _is_nav_noise(raw_text):
            continue

        # Must contain at least one relevant keyword
        if not _has_announcement_keyword(raw_text):
            # Also accept if the URL path looks like a notice/document
            if not any(kw in raw_href.lower() for kw in ["notice", "result", "notification", "admit", "recruitment", "exam", "schedule", "syllabus", "pdf"]):
                continue

        # Skip empty or javascript: hrefs
        if not raw_href or raw_href.startswith("javascript:") or raw_href == "#":
            continue

        # Build absolute URL
        absolute_url = urljoin(base_url, raw_href)

        # Sanity check — must be http/https
        parsed = urlparse(absolute_url)
        if parsed.scheme not in ("http", "https"):
            continue

        announcements.append({
            "text": raw_text,
            "url": absolute_url,
        })

        if len(announcements) >= 20:
            break

    return announcements


async def _create_stealth_context(browser: Browser) -> BrowserContext:
    """
    Create a browser context that closely mimics a real human session:
    - Premium Chrome user-agent
    - Human-like HTTP headers
    - Realistic locale and timezone
    - Hidden automation fingerprint
    """
    context = await browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=STEALTH_USER_AGENT,
        locale="en-US",
        timezone_id="Asia/Kolkata",
        java_script_enabled=True,
        accept_downloads=False,
        extra_http_headers=STEALTH_EXTRA_HEADERS,
    )

    # Mask the webdriver / automation property so bot-detection scripts see a clean browser
    await context.add_init_script(
        """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
        """
    )

    return context


# ---------------------------------------------------------------------------
# Per-site scraper
# ---------------------------------------------------------------------------

async def scrape_site(browser: Browser, site: SiteTarget, max_retries: int = 3) -> Dict[str, Any]:
    """
    Attempt to scrape a single government portal.

    Returns a dict with:
      - site_name, source_url, title, fetched_at
      - announcements: List[{text, url}] — individual deep-linked notices
      - content: joined text of all announcements (for Gemini processing)

    Each attempt uses a fresh stealth browser context.
    Raises ScraperError after all retries are exhausted.
    """
    last_error: Optional[Exception] = None

    for attempt in range(max_retries):
        context: Optional[BrowserContext] = None
        page: Optional[Page] = None

        try:
            logger.info(
                "[INFO] Scraping %s (attempt %d/%d)…",
                site.name, attempt + 1, max_retries,
            )

            context = await _create_stealth_context(browser)
            page = await context.new_page()
            page.set_default_timeout(20_000)

            logger.debug("[DEBUG] Navigating to %s (domcontentloaded)", site.url)
            await page.goto(site.url, wait_until="domcontentloaded", timeout=30_000)

            # Brief human-like pause before reading DOM
            await page.wait_for_timeout(1200)

            title = await page.title()

            # Extract structured announcement links with deep hrefs
            announcements = await _extract_announcement_links(page, site.url)

            if not announcements:
                raise ScraperError(f"No announcement links extracted from {site.url}")

            logger.info(
                "[INFO] Successfully extracted %d announcement links from %s",
                len(announcements), site.name,
            )

            # Build a combined text blob for AI processing
            # Each line: "TITLE: <title> | URL: <url>"
            content_lines = [
                f"ANNOUNCEMENT: {item['text']} | LINK: {item['url']}"
                for item in announcements
            ]
            content = "\n".join(content_lines)

            return {
                "site_name": site.name,
                "source_url": site.url,
                "title": title.strip(),
                "content": content,
                "announcements": announcements,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }

        except (PlaywrightTimeoutError, ScraperError, OSError) as exc:
            last_error = exc
            logger.warning(
                "[WARN] Scrape failed for %s on attempt %d/%d: %s",
                site.name, attempt + 1, max_retries, exc,
            )
            if attempt < max_retries - 1:
                await _sleep_with_backoff(attempt)

        except Exception as exc:
            last_error = exc
            logger.exception("[ERROR] Unexpected scrape failure for %s: %s", site.name, exc)
            if attempt < max_retries - 1:
                await _sleep_with_backoff(attempt)

        finally:
            if page is not None:
                try:
                    await page.close()
                except Exception:
                    pass
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass

    logger.error(
        "[ERROR] Failed to scrape %s after %d attempts: %s",
        site.name, max_retries, last_error,
    )
    raise ScraperError(
        f"Failed to scrape {site.name} after {max_retries} attempts: {last_error}"
    ) from last_error


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def scrape_all_sites(sites: Optional[List[SiteTarget]] = None) -> List[Dict[str, Any]]:
    """
    Scrape all government portals sequentially with full anti-bot stealth.

    Each individual portal scrape is enclosed in its own localized try/except
    block.  If a domain times out or is firewalled, the error is logged and the
    loop immediately continues to the next site so all remaining portals load
    unhindered.

    Returns a list of successfully scraped page dictionaries, each with an
    'announcements' key holding deep-linked notice items.
    """
    selected_sites = sites or GOVERNMENT_SITES
    logger.info("[INFO] Starting stealth scraper for %d site(s)", len(selected_sites))

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=STEALTH_LAUNCH_ARGS,
        )
        try:
            results: List[Dict[str, Any]] = []

            for site in selected_sites:
                try:
                    result = await scrape_site(browser, site)
                    results.append(result)
                except ScraperError as exc:
                    logger.error(
                        "[ERROR] Skipping %s — scrape failed: %s. Proceeding to next portal.",
                        site.name, exc,
                    )
                    continue
                except Exception as exc:
                    logger.exception(
                        "[ERROR] Unexpected error for %s: %s. Proceeding to next portal.",
                        site.name, exc,
                    )
                    continue

            logger.info(
                "[INFO] Scraper completed: %d/%d sites successful",
                len(results), len(selected_sites),
            )
            return results

        finally:
            await browser.close()
            logger.debug("[DEBUG] Stealth browser closed")
