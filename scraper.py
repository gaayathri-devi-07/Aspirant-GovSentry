from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from playwright.async_api import Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError, async_playwright

logger = logging.getLogger(__name__)

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
    """Exponential back-off with ±15 % jitter so retry bursts don't align."""
    delay = min(max_delay, base_delay * (2 ** attempt))
    jitter = delay * 0.15
    await asyncio.sleep(delay + jitter)


async def _extract_page_text(page: Page) -> str:
    """
    Harvest the most content-rich text block from the page.
    Tries common notification-area selectors first, then falls back
    to <main>, <article>, and finally the full <body>.
    """
    notification_selectors = [
        "div[class*='notification']",
        "div[class*='alert']",
        "div[class*='notice']",
        "div[class*='update']",
        "div[class*='news']",
        "ul[class*='notice']",
        "ul[class*='news']",
        "section[class*='notice']",
    ]

    for selector in notification_selectors:
        try:
            await page.wait_for_selector(selector, timeout=4000)
            break
        except Exception:
            continue

    candidates = ["body", "main", "article"]
    texts: List[str] = []
    for selector in candidates:
        try:
            text = await page.locator(selector).inner_text(timeout=4000)
            if text and len(text.strip()) > 200:
                texts.append(text.strip())
        except Exception:
            continue

    if texts:
        return "\n\n".join(texts)

    # Last resort: raw JS evaluation
    try:
        return await page.evaluate("() => document.body ? document.body.innerText : ''")
    except Exception as exc:
        raise ScraperError(f"Unable to read page text: {exc}") from exc


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
# Per-site scraper (isolated try/except so one failure never blocks others)
# ---------------------------------------------------------------------------

async def scrape_generic_site(page: Page, url: str) -> str:
    """
    Generic scraper fallback.
    Extracts the newest bulletins or links using a generalized heuristic,
    specifically locating <a> tags containing key words or dates.
    """
    bulletins = await page.evaluate(
        """
        () => {
            const keywords = ["notice", "result", "apply", "notification", "schedule", "admit", "date", "recruitment", "exam", "announcement"];
            const links = Array.from(document.querySelectorAll('a'));
            const matches = [];
            
            for (const link of links) {
                const text = link.innerText.trim();
                if (text.length > 5) {
                    const textLower = text.toLowerCase();
                    const hasKeyword = keywords.some(kw => textLower.includes(kw));
                    const hasYear = /202[4-9]/.test(textLower);
                    if (hasKeyword || hasYear) {
                        matches.push(`${text} (Link: ${link.href})`);
                    }
                }
            }
            if (matches.length === 0) {
                const pTags = Array.from(document.querySelectorAll('p, li, td'));
                for (const p of pTags) {
                    const text = p.innerText.trim();
                    if (text.length > 20 && text.length < 300) {
                        const textLower = text.toLowerCase();
                        if (keywords.some(kw => textLower.includes(kw))) {
                            matches.push(text);
                        }
                    }
                }
            }
            return matches.slice(0, 15).join('\\n\\n');
        }
        """
    )
    if bulletins:
        return f"Bulletins extracted from custom URL:\n\n{bulletins}"
    else:
        return await page.evaluate("() => document.body ? document.body.innerText.slice(0, 3000) : ''")


async def scrape_site(browser: Browser, site: SiteTarget, max_retries: int = 3) -> Dict[str, Any]:
    """
    Attempt to scrape a single government portal.

    Each attempt uses a fresh stealth browser context.  Navigation uses
    ``wait_until="domcontentloaded"`` (instead of the slower and bot-flagging
    ``networkidle``) so parsing begins the moment the DOM text tree is ready.

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
            await page.wait_for_timeout(800)

            title = await page.title()
            
            # Check if this URL is one of the default 6
            is_custom = True
            for default_site in GOVERNMENT_SITES:
                if default_site.url.replace("www.", "") in site.url.replace("www.", "") or site.url.replace("www.", "") in default_site.url.replace("www.", ""):
                    is_custom = False
                    break

            if is_custom:
                logger.info("[INFO] Using Generic Scraper fallback for custom URL: %s", site.url)
                text = await scrape_generic_site(page, site.url)
            else:
                text = await _extract_page_text(page)

            if not text.strip():
                raise ScraperError("Empty page body text after DOM load")

            logger.info(
                "[INFO] Successfully scraped %s (%d chars)",
                site.name, len(text),
            )

            return {
                "site_name": site.name,
                "source_url": site.url,
                "title": title.strip(),
                "content": text.strip(),
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
            # Always close page + context to free memory and avoid session leaks
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
# Orchestrator — each portal is wrapped in its own try/except so a single
# firewall timeout never blocks the rest of the pipeline
# ---------------------------------------------------------------------------

async def scrape_all_sites(sites: Optional[List[SiteTarget]] = None) -> List[Dict[str, Any]]:
    """
    Scrape all government portals sequentially with full anti-bot stealth.

    Each individual portal scrape is enclosed in its own localized try/except
    block.  If a domain times out or is firewalled, the error is logged and the
    loop immediately continues to the next site so all remaining portals load
    unhindered.

    Returns a list of successfully scraped page dictionaries.
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
                # ── Per-portal isolation boundary ──────────────────────────
                # A timeout or connection error on one domain MUST NOT prevent
                # the remaining portals from being scraped.
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
                # ── End per-portal boundary ────────────────────────────────

            logger.info(
                "[INFO] Scraper completed: %d/%d sites successful",
                len(results), len(selected_sites),
            )
            return results

        finally:
            await browser.close()
            logger.debug("[DEBUG] Stealth browser closed")
