from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Sequence

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ParsedUpdate:
    exam_name: str
    update_type: str
    old_value: str
    new_value: str
    summary: str
    source_url: str
    site_name: str
    raw_text: str
    content_hash: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "exam_name": self.exam_name,
            "update_type": self.update_type,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "summary": self.summary,
            "source_url": self.source_url,
            "site_name": self.site_name,
            "raw_text": self.raw_text,
            "content_hash": self.content_hash,
        }


class GeminiProcessor:
    def __init__(self, api_key: str | None = None, model_name: str = "gemini-2.5-flash") -> None:
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
        self.model_name = model_name
        self._model = None
        if self.api_key:
            try:
                import google.generativeai as genai

                genai.configure(api_key=self.api_key)
                self._model = genai.GenerativeModel(self.model_name)
            except Exception as exc:  # pragma: no cover - model init failures are environment-specific
                logger.warning("Gemini initialization failed: %s", exc)
                self._model = None

    @staticmethod
    def _build_content_hash(site_name: str, source_url: str, payload: Dict[str, Any]) -> str:
        fingerprint = json.dumps(
            {
                "site_name": site_name,
                "source_url": source_url,
                "exam_name": payload.get("exam_name", ""),
                "update_type": payload.get("update_type", ""),
                "old_value": payload.get("old_value", ""),
                "new_value": payload.get("new_value", ""),
                "summary": payload.get("summary", ""),
            },
            sort_keys=True,
            ensure_ascii=True,
        )
        return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalize_text(text: str) -> str:
        collapsed = re.sub(r"\s+", " ", text)
        return collapsed.strip()

    def _heuristic_parse(self, site_name: str, source_url: str, raw_text: str) -> List[ParsedUpdate]:
        text = self._normalize_text(raw_text)
        lowered = text.lower()
        if not text:
            return []

        keywords = [
            ("admit card", "Admit Card Out"),
            ("postponed", "Exam Postponed"),
            ("result", "Result Declared"),
            ("answer key", "Answer Key"),
            ("corrigendum", "Correction Window"),
            ("city intimation", "City Intimation"),
            ("application", "Application Started"),
            ("notification", "Notification"),
        ]
        detected_type = "Notification"
        for keyword, label in keywords:
            if keyword in lowered:
                detected_type = label
                break

        exam_name = site_name
        title_match = re.search(r"(ssc|tnpsc|upsc|ibps|rrb|nta)[^|\-:\n]{0,80}", text, re.IGNORECASE)
        if title_match:
            exam_name = title_match.group(0).strip(" -:|\n")

        summary = text[:260]
        payload = {
            "exam_name": exam_name,
            "update_type": detected_type,
            "old_value": "",
            "new_value": summary,
            "summary": summary,
        }
        content_hash = self._build_content_hash(site_name, source_url, payload)
        return [
            ParsedUpdate(
                exam_name=payload["exam_name"],
                update_type=payload["update_type"],
                old_value=payload["old_value"],
                new_value=payload["new_value"],
                summary=payload["summary"],
                source_url=source_url,
                site_name=site_name,
                raw_text=text,
                content_hash=content_hash,
            )
        ]

    @staticmethod
    def _coerce_json_payload(payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            if "updates" in payload and isinstance(payload["updates"], list):
                return [item for item in payload["updates"] if isinstance(item, dict)]
            return [payload]
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        return []

    @staticmethod
    def _extract_json(text: str) -> Any:
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?", "", stripped, flags=re.IGNORECASE).strip()
            stripped = re.sub(r"```$", "", stripped).strip()
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            match = re.search(r"(\{.*\}|\[.*\])", stripped, re.DOTALL)
            if match:
                return json.loads(match.group(1))
            raise

    def _prompt(self, site_name: str, source_url: str, raw_text: str) -> str:
        return f"""You are an expert parser for Indian Government Exam updates. Analyze the following raw scraped text from {site_name}. Search for any active, new updates regarding exam dates, admit cards, or results.

**CRITICAL INSTRUCTIONS:**
1. If a real update is found, extract it EXACTLY into this JSON schema:
{{
  "exam_name": "Name of the specific exam",
  "update_type": "Admit Card Out" | "Date Changed" | "Result Declared" | "New Exam Announced" | "Answer Key Released" | "Notification" | "Other",
  "old_value": "previous date/status if visible, else null or empty string",
  "new_value": "current new date or status",
  "summary": "A concise, single sentence plain-English explanation."
}}

2. If absolutely no updates or notifications are found in the text, return an empty JSON object: {{}}

3. Return ONLY valid JSON. No markdown formatting, no code blocks, no explanations.

4. update_type MUST be one of the exact values listed above.

5. summary must be a single sentence, under 150 characters.

6. old_value and new_value should be specific data (dates, statuses) or null/empty strings.

Site: {site_name}
URL: {source_url}

Page content to analyze:
{raw_text[:10000]}
""".strip()

    def parse_updates(self, site_name: str, source_url: str, raw_text: str) -> List[ParsedUpdate]:
        normalized_text = self._normalize_text(raw_text)
        if not normalized_text:
            return []

        if not self._model:
            return self._heuristic_parse(site_name, source_url, normalized_text)

        try:
            response = self._model.generate_content(
                self._prompt(site_name, source_url, normalized_text),
                generation_config={
                    "temperature": 0.1,
                    "response_mime_type": "application/json",
                },
            )
            response_text = getattr(response, "text", "") or ""
            
            # Handle empty response (no updates found)
            if not response_text.strip() or response_text.strip() in ["{}", "[]"]:
                logger.info("[INFO] No updates found for %s by Gemini", site_name)
                return []
            
            parsed = self._extract_json(response_text)
            
            # If Gemini returns empty object, no updates found
            if parsed == {} or parsed == []:
                logger.info("[INFO] Gemini returned empty result for %s", site_name)
                return []
            
            payloads = self._coerce_json_payload(parsed)
            results: List[ParsedUpdate] = []

            if not payloads:
                return []

            for payload in payloads:
                # Skip if the payload is empty
                if not payload.get("exam_name") and not payload.get("summary"):
                    continue
                    
                record = {
                    "exam_name": str(payload.get("exam_name", site_name)).strip() or site_name,
                    "update_type": str(payload.get("update_type", "Other")).strip() or "Other",
                    "old_value": str(payload.get("old_value", "")).strip(),
                    "new_value": str(payload.get("new_value", "")).strip(),
                    "summary": str(payload.get("summary", "")).strip(),
                }
                if not record["summary"]:
                    record["summary"] = record["new_value"][:260] or normalized_text[:260]
                record["content_hash"] = self._build_content_hash(site_name, source_url, record)
                results.append(
                    ParsedUpdate(
                        exam_name=record["exam_name"],
                        update_type=record["update_type"],
                        old_value=record["old_value"],
                        new_value=record["new_value"],
                        summary=record["summary"],
                        source_url=source_url,
                        site_name=site_name,
                        raw_text=normalized_text,
                        content_hash=record["content_hash"],
                    )
                )
            return results
        except Exception as exc:
            logger.warning("[WARN] Gemini parsing failed for %s: %s", site_name, exc)
            return []
