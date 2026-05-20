from __future__ import annotations
import time
from typing import Optional

import asyncio
import csv
import json
import os
import random
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from playwright.async_api import (
    Error as PlaywrightError,
)
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from pydantic import BaseModel, Field, ValidationError


# =========================
# Output Schema
# =========================

class CurrentEmployment(BaseModel):
    title: str = ""
    company: str = ""
    duration: str = ""
    location: str = ""


class ExperienceItem(BaseModel):
    role: str = ""
    company: str = ""
    duration: str = ""
    location: str = ""
    description: str = ""


class EducationItem(BaseModel):
    school: str = ""
    degree: str = ""
    field_of_study: str = ""


class ProfileData(BaseModel):
    full_name: str = ""
    headline: str = ""
    location: str = ""
    about: str = ""
    current_employment: CurrentEmployment = Field(default_factory=CurrentEmployment)
    experience: list[ExperienceItem] = Field(default_factory=list)
    education: list[EducationItem] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)


# =========================
# Config
# =========================

@dataclass
class ScrapeConfig:
    profile_url: str
    provider: Literal["gemini", "openai"] = "gemini"
    model: str = "gemini-2.5-flash"
    user_data_dir: str = "linkedin_session"
    headless: bool = True


SYSTEM_PROMPT = """
You are a high-speed LinkedIn profile extraction engine.

Your task is ONLY to convert a fully loaded LinkedIn profile DOM snapshot into clean structured JSON.

STRICT RULES:
- Single-pass extraction only
- No browsing logic
- No additional navigation
- Output ONLY valid JSON (no markdown, no explanation)
- Do not hallucinate missing values
- Missing strings => ""
- Missing arrays => []

Return exactly this schema:
{
  "full_name": "",
  "headline": "",
  "location": "",
  "about": "",
  "current_employment": {
    "title": "",
    "company": "",
    "duration": "",
    "location": ""
  },
  "experience": [
    {
      "role": "",
      "company": "",
      "duration": "",
      "location": "",
      "description": ""
    }
  ],
  "education": [
    {
      "school": "",
      "degree": "",
      "field_of_study": ""
    }
  ],
  "skills": []
}
""".strip()


# =========================
# LLM Providers
# =========================

class LLMProvider(BaseModel):
    provider: Literal["gemini", "openai"]
    model: str

    def get_completion(self, prompt: str, system_prompt: str) -> str:
        raise NotImplementedError


def _extract_retry_delay_seconds(error_text: str) -> float | None:
    m = re.search(r"retry in\s*([0-9]+(?:\.[0-9]+)?)s", error_text, flags=re.IGNORECASE)
    if m:
        return float(m.group(1))
    m = re.search(r"retryDelay['\"]?\s*:\s*['\"]?([0-9]+)s", error_text, flags=re.IGNORECASE)
    if m:
        return float(m.group(1))
    m = re.search(r"retry[_\s]*delay[\s\S]*?seconds:\s*([0-9]+)", error_text, flags=re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


class GeminiProvider(LLMProvider):
    provider: Literal["gemini"] = "gemini"
    model: str = Field(default="gemini-2.5-flash")

    def get_completion(self, prompt: str, system_prompt: str) -> str:
        from google import genai

        google_api_key = os.environ.get("GOOGLE_API_KEY")
        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        openai_api_key = os.environ.get("OPENAI_API_KEY")

        api_key = google_api_key or gemini_api_key
        if not api_key:
            raise RuntimeError("Missing GOOGLE_API_KEY/GEMINI_API_KEY.")

        if google_api_key and gemini_api_key:
            print("Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.")
        elif gemini_api_key and not google_api_key:
            print("Using GEMINI_API_KEY.")

        client = genai.Client(api_key=api_key)
        combined_prompt = f"{system_prompt}\n\n{prompt}"

        model_candidates = [self.model]
        for m in ("gemini-2.0-flash-lite", "gemini-1.5-flash"):
            if m not in model_candidates:
                model_candidates.append(m)

        last_err: Exception | None = None

        for model_name in model_candidates:
            for attempt in range(3):
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=combined_prompt,
                        config={"response_mime_type": "application/json"},
                    )
                    text = getattr(response, "text", None)
                    if text and text.strip():
                        return text.strip()
                    raise RuntimeError("Gemini returned empty response.")
                except Exception as e:
                    last_err = e
                    msg = str(e)
                    is_quota = (
                        "429" in msg
                        or "resource_exhausted" in msg.lower()
                        or "quota" in msg.lower()
                    )
                    if is_quota and attempt < 2:
                        wait_s = _extract_retry_delay_seconds(msg) or min(8 * (2 ** attempt), 60)
                        print(f"[Gemini] quota/rate hit, retrying in {wait_s:.1f}s (attempt {attempt+1}/3)...")
                        time.sleep(wait_s + 0.5)
                        continue
                    break

        if openai_api_key:
            print("[Gemini] quota exhausted across fallback models. Switching to OpenAI fallback...")
            return OpenAIProvider(model="gpt-4o-mini").get_completion(prompt=prompt, system_prompt=system_prompt)

        print("[Gemini] quota exhausted and no OpenAI key. Returning empty profile JSON.")
        return json.dumps(ProfileData().model_dump(), ensure_ascii=False)


class OpenAIProvider(LLMProvider):
    provider: Literal["openai"] = "openai"
    model: str = Field(default="gpt-4o-mini")

    def get_completion(self, prompt: str, system_prompt: str) -> str:
        from openai import OpenAI

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is missing.")

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        content = resp.choices[0].message.content
        if not content:
            raise RuntimeError("OpenAI returned empty response.")
        return content


def _provider_from_config(config: ScrapeConfig) -> LLMProvider:
    if config.provider == "gemini":
        return GeminiProvider(model=config.model)
    if config.provider == "openai":
        return OpenAIProvider(model=config.model)
    raise ValueError(f"Unsupported provider: {config.provider}")


# =========================
# Playwright helpers
# =========================

SECTION_SELECTORS = {
    "experience": "section#experience, section[id*='experience'], a[href*='/details/experience/']",
    "education": "section[id*='education'], a[href*='/details/education/']",
    "skills": "section[id*='skills'], a[href*='/details/skills/']",
    "about": "section[id*='about'], a[href*='/details/about/']",
}

# Multi-signal profile readiness selectors (no strict h1 dependency)
PROFILE_SIGNAL_SELECTORS = {
    "h1": "h1",
    "main": "main",
    "div_ph5": "div.ph5",
    "experience_section": "section[id*='experience']",
    "education_section": "section[id*='education']",
    "profile_image": "img.pv-top-card-profile-picture__image",
}


async def _detect_and_raise_if_blocked(page: Any) -> None:
    url = page.url.lower()
    auth_markers = ["/login", "authwall", "checkpoint", "challenge"]
    has_auth_url = any(x in url for x in auth_markers)

    profile_signal_count = await page.locator(
        "main h1, section#experience, section[id*='education'], section[id*='skills']"
    ).count()

    if has_auth_url and profile_signal_count == 0:
        raise RuntimeError(
            "LinkedIn blocked/redirected the session. Run login with SAME --user-data-dir."
        )


async def _smooth_scroll(page: Any, rounds: int = 8, pause_ms: int = 120) -> None:
    for _ in range(rounds):
        await page.mouse.wheel(0, 1600)
        await page.wait_for_timeout(pause_ms)


def _looks_like_expand_text(text: str) -> bool:
    t = re.sub(r"\s+", " ", text.strip().lower())
    patterns = ("see more", "show more", "more", "show all", "view more")
    return any(p in t for p in patterns)


async def _wait_for_profile_loaded(page: Any) -> dict[str, Any]:
    """
    Staged profile readiness:
    Stage 1: wait for domcontentloaded
    Stage 2: human-like delay (2-4s)
    Stage 3: adaptive multi-signal detection loop (every 2s, max 35s)

    Readiness is true when:
    - any profile selector appears, OR
    - fallback: URL contains /in/ and body text length > 2000
    """
    print("   ⏳ staged profile readiness started...")

    # Stage 1: domcontentloaded
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=20000)
    except PlaywrightTimeoutError:
        print("   ⚠️ domcontentloaded wait timed out, continuing with best-effort checks")

    # Stage 2: human-like delay
    human_delay_ms = random.randint(2000, 4000)
    print(f"   ⏸  stage-2 human delay: {human_delay_ms}ms")
    await page.wait_for_timeout(human_delay_ms)

    # Stage 3: adaptive wait loop
    start = time.monotonic()
    max_wait_s = 35
    poll_interval_ms = 2000

    last_url = page.url
    last_detected: list[str] = []
    last_body_len = 0
    last_selector_hits: dict[str, int] = {}

    while (time.monotonic() - start) <= max_wait_s:
        current_url = page.url
        selector_hits: dict[str, int] = {}
        detected: list[str] = []

        for name, selector in PROFILE_SIGNAL_SELECTORS.items():
            try:
                count = await page.locator(selector).count()
            except PlaywrightError:
                count = 0
            selector_hits[name] = count
            if count > 0:
                detected.append(name)

        try:
            body_text = await page.locator("body").inner_text()
            body_len = len(body_text or "")
        except PlaywrightError:
            body_len = 0

        fallback_profile = ("/in/" in current_url.lower()) and (body_len > 2000)

        elapsed = time.monotonic() - start
        print(
            f"   🔍 readiness poll t+{elapsed:.1f}s | "
            f"url={current_url} | detected={detected if detected else 'none'} | body_chars={body_len}"
        )

        last_url = current_url
        last_detected = detected
        last_body_len = body_len
        last_selector_hits = selector_hits

        if detected or fallback_profile:
            if detected:
                reason = f"selector signal(s): {', '.join(detected)}"
            else:
                reason = "fallback: URL contains /in/ and body_text > 2000"

            print(f"   ✅ profile detected | final readiness reason: {reason}")
            print("   ⏳ stabilization delay 3000ms before snapshot")
            await page.wait_for_timeout(3000)

            return {
                "ready": True,
                "reason": reason,
                "url": current_url,
                "detected_selectors": detected,
                "selector_hits": selector_hits,
                "body_text_len": body_len,
            }

        await page.wait_for_timeout(poll_interval_ms)

    timeout_reason = "timeout after 35s; continuing best-effort"
    print(
        f"   ⚠️ readiness timeout | url={last_url} | "
        f"detected={last_detected if last_detected else 'none'} | "
        f"body_chars={last_body_len} | final readiness reason: {timeout_reason}"
    )

    return {
        "ready": False,
        "reason": timeout_reason,
        "url": last_url,
        "detected_selectors": last_detected,
        "selector_hits": last_selector_hits,
        "body_text_len": last_body_len,
    }
async def _progressive_scroll_until_stable(
    page: Any,
    max_rounds: int = 30,
    stable_rounds_needed: int = 2,
) -> None:
    """
    Lazy-load scrolling:
    - slow human-like wheel scrolls
    - pause between scrolls
    - stop when page height stops increasing twice
    """
    print("   🧭 starting lazy-load scroll...")

    stable_rounds = 0
    last_height = 0

    for i in range(1, max_rounds + 1):
        try:
            curr_height = await page.evaluate("() => document.body.scrollHeight")
        except PlaywrightError:
            curr_height = last_height

        if curr_height <= (last_height + 60):
            stable_rounds += 1
        else:
            stable_rounds = 0

        wheel_px = random.randint(500, 1100)
        pause_ms = random.randint(700, 1400)
        await page.mouse.wheel(0, wheel_px)
        await page.wait_for_timeout(pause_ms)

        print(
            f"   ↕️ scroll round {i} | height={curr_height} | "
            f"stable_rounds={stable_rounds}/{stable_rounds_needed}"
        )

        if stable_rounds >= stable_rounds_needed:
            break

        if curr_height > last_height:
            last_height = curr_height

    print("   ✅ lazy-load scroll completed")


async def _has_experience_signal(page: Any) -> bool:
    try:
        count = await page.locator(SECTION_SELECTORS["experience"]).count()
        if count > 0:
            return True
    except PlaywrightError:
        pass

    try:
        body_text = await page.locator("body").inner_text()
        return "experience" in (body_text or "").lower()
    except PlaywrightError:
        return False


def _snapshot_is_too_small(snap: dict[str, str]) -> bool:
    return (
        len(snap.get("html", "")) < 20_000
        or len(snap.get("body_text", "")) < 1_000
        or len(snap.get("main_text", "")) < 250
    )


async def _capture_snapshot(page: Any) -> dict[str, str]:
    html = await page.content()
    main_text = await page.locator("main").inner_text() if await page.locator("main").count() else ""
    body_text = await page.locator("body").inner_text()

    print(
        f"   🧾 snapshot size chars | main={len(main_text)} body={len(body_text)} html={len(html)}"
    )

    max_chars = 450_000
    return {
        "main_text": main_text[:max_chars],
        "body_text": body_text[:max_chars],
        "html": html[:max_chars],
        "url": page.url,
    }


async def _expand_all_buttons(page: Any, profile_url: str, passes: int = 1) -> int:
    """
    Click all expandable buttons (See More, Show More, etc.) on the profile page.
    Returns the total number of buttons clicked.
    """
    total_clicked = 0
    for _ in range(passes):
        try:
            buttons = await page.query_selector_all("button, a[role='button']")
            for button in buttons:
                text = await button.text_content()
                if _looks_like_expand_text(text):
                    await button.click()
                    total_clicked += 1
                    await page.wait_for_timeout(300)
        except Exception:
            pass
    return total_clicked


async def _prepare_and_capture_snapshot(page: Any, profile_url: str) -> dict[str, str]:
    """
    Full readiness + snapshot with one retry if:
    - snapshot too small
    - experience section missing
    """
    last_snap: dict[str, str] | None = None

    for attempt in range(1, 3):
        if attempt > 1:
            print("   🔁 retrying profile readiness before snapshot...")

        readiness = await _wait_for_profile_loaded(page)
        print(
            f"   🧠 readiness summary | url={readiness.get('url')} | "
            f"detected={readiness.get('detected_selectors')} | "
            f"body_chars={readiness.get('body_text_len')} | "
            f"reason={readiness.get('reason')}"
        )

        await _progressive_scroll_until_stable(page, max_rounds=30, stable_rounds_needed=2)

        clicked = await _expand_all_buttons(page, profile_url=profile_url, passes=5)
        print(f"   🔎 expanded buttons clicked: {clicked}")

        await _progressive_scroll_until_stable(page, max_rounds=16, stable_rounds_needed=2)

        stabilize_ms = random.randint(2000, 5000)
        print(f"   ⏳ stabilization delay {stabilize_ms}ms")
        await page.wait_for_timeout(stabilize_ms)

        snap = await _capture_snapshot(page)
        last_snap = snap

        experience_present = await _has_experience_signal(page)
        too_small = _snapshot_is_too_small(snap)

        if not too_small and experience_present:
            return snap

        reason = []
        if too_small:
            reason.append("snapshot too small")
        if not experience_present:
            reason.append("experience section missing")
        print(f"   ⚠️ snapshot quality warning: {', '.join(reason)}")

        if attempt == 1:
            await _smooth_scroll(page, rounds=4, pause_ms=random.randint(120, 220))
            await page.wait_for_timeout(random.randint(700, 1500))

    return last_snap or {"main_text": "", "body_text": "", "html": "", "url": page.url}


def _strip_markdown_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    return raw.strip()


def _to_profile_data(raw_json: str) -> ProfileData:
    cleaned = _strip_markdown_fences(raw_json)
    parsed = json.loads(cleaned)
    data = ProfileData(**parsed)
    data.experience = data.experience or []
    data.education = data.education or []
    data.skills = data.skills or []
    if not data.current_employment:
        data.current_employment = CurrentEmployment()
    return data


# =========================
# Human-like noise helpers
# =========================

FEED_LIKE_URLS = [
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/mynetwork/",
    "https://www.linkedin.com/notifications/",
]


async def _human_pause(min_s: float = 2.0, max_s: float = 6.0) -> None:
    delay = random.uniform(min_s, max_s)
    print(f"   ⏸  human pause {delay:.1f}s")
    await asyncio.sleep(delay)


async def _simulate_feed_browsing(page: Any) -> None:
    """Open a random feed-like page, scroll a bit, then leave."""
    try:
        target = random.choice(FEED_LIKE_URLS)
        print(f"   🌐 noise: visiting {target}")
        await page.goto(target, wait_until="domcontentloaded", timeout=20000)
        await page.wait_for_timeout(random.randint(800, 1800))
        for _ in range(random.randint(2, 5)):
            await page.mouse.wheel(0, random.randint(600, 1800))
            await page.wait_for_timeout(random.randint(400, 1200))
        await _human_pause(1.5, 3.5)
    except PlaywrightError as e:
        print(f"   ⚠️  noise browsing failed: {e}")


# =========================
# Core scrape (single page) — uses an existing context
# =========================

async def _scrape_profile_on_page(page: Any, profile_url: str) -> dict[str, str]:
    await page.goto(profile_url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(random.randint(700, 1600))

    await _detect_and_raise_if_blocked(page)
    snap = await _prepare_and_capture_snapshot(page, profile_url=profile_url)
    return snap


async def scrape_linkedin(config: ScrapeConfig) -> ProfileData:
    """Backwards-compatible single-profile scrape (unchanged signature)."""
    provider = _provider_from_config(config)

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=config.user_data_dir,
            headless=config.headless,
            viewport={"width": 1366, "height": 900},
            args=["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
        )
        page = context.pages[0] if context.pages else await context.new_page()

        try:
            snap = await _scrape_profile_on_page(page, config.profile_url)
        finally:
            await context.close()

    prompt = (
        "Extract profile data from this already-loaded LinkedIn snapshot.\n\n"
        f"URL:\n{snap['url']}\n\n"
        f"MAIN_TEXT:\n{snap['main_text']}\n\n"
        f"BODY_TEXT:\n{snap['body_text']}\n\n"
        f"HTML:\n{snap['html']}"
    )

    try:
        raw = provider.get_completion(prompt=prompt, system_prompt=SYSTEM_PROMPT)
    except Exception as e:
        print(f"[LLM ERROR] {e}")
        return ProfileData()

    try:
        return _to_profile_data(raw)
    except (json.JSONDecodeError, ValidationError):
        return ProfileData()


# =========================
# CSV batch mode
# =========================

def get_username_from_url(url: str) -> str:
    match = re.search(r"linkedin\.com/in/([^/?]+)", url)
    if match:
        return match.group(1)
    return "profile"


def _read_csv_rows(csv_path: str) -> list[dict]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for r in reader:
            # normalize keys
            normalized = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
            rows.append(normalized)
        return rows


def _write_csv_rows(csv_path: str, rows: list[dict]) -> None:
    fieldnames = ["profile_url", "completed_at"]
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({
                "profile_url": r.get("profile_url", ""),
                "completed_at": r.get("completed_at", ""),
            })


async def scrape_from_csv(
    csv_path: str,
    provider: str = "gemini",
    model: str = "gemini-2.5-flash",
    user_data_dir: str = "linkedin_session",
    headless: bool = True,
    output_dir: str = "data",
) -> None:
    rows = _read_csv_rows(csv_path)
    if not rows:
        print(f"❌ No rows in {csv_path}")
        return

    os.makedirs(output_dir, exist_ok=True)
    llm = _provider_from_config(ScrapeConfig(profile_url="", provider=provider, model=model))

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=headless,
            viewport={"width": 1366, "height": 900},
            args=["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
        )
        page = context.pages[0] if context.pages else await context.new_page()

        # warm-up: behave like a human landing on LinkedIn
        await _simulate_feed_browsing(page)

        try:
            total = len(rows)
            for idx, row in enumerate(rows, start=1):
                url = row.get("profile_url", "")
                if not url:
                    continue

                if row.get("completed_at"):
                    print(f"[{idx}/{total}] ⏭  skip (already done): {url}")
                    continue

                print(f"\n[{idx}/{total}] 🔎 scraping: {url}")

                try:
                    snap = await _scrape_profile_on_page(page, url)
                except Exception as e:
                    print(f"   ❌ navigation/scrape error: {e}")
                    continue

                prompt = (
                    "Extract profile data from this already-loaded LinkedIn snapshot.\n\n"
                    f"URL:\n{snap['url']}\n\n"
                    f"MAIN_TEXT:\n{snap['main_text']}\n\n"
                    f"BODY_TEXT:\n{snap['body_text']}\n\n"
                    f"HTML:\n{snap['html']}"
                )

                try:
                    raw = llm.get_completion(prompt=prompt, system_prompt=SYSTEM_PROMPT)
                    data = _to_profile_data(raw)
                except Exception as e:
                    print(f"   ❌ LLM/parse error: {e}")
                    data = ProfileData()

                username = get_username_from_url(url)
                file_path = os.path.join(output_dir, f"{username}.json")
                with open(file_path, "w", encoding="utf-8") as f:
                    json.dump(data.model_dump(), f, indent=2, ensure_ascii=False)
                print(f"   ✅ saved {file_path}")

                # mark completed + persist CSV after every profile
                row["completed_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                _write_csv_rows(csv_path, rows)

                # human noise between profiles
                if idx < total:
                    # occasionally browse feed
                    if random.random() < 0.35:
                        await _simulate_feed_browsing(page)
                    await _human_pause(4.0, 12.0)
        finally:
            await context.close()


# =========================
# CLI
# =========================

async def main():
    args = sys.argv[1:]

    # CSV mode: python script.py --csv profiles.csv
    if args and args[0] == "--csv":
        if len(args) < 2:
            print("❌ Usage: python script.py --csv <path-to-csv>")
            return
        csv_path = args[1]
        await scrape_from_csv(
            csv_path=csv_path,
            provider="gemini",
            model="gemini-2.5-flash",
            user_data_dir="linkedin_session",
            headless=True,
            output_dir="data",
        )
        return

    # Original manual single-URL mode (unchanged behavior)
    url = args[0] if args else None
    if not url:
        print("❌ Please provide LinkedIn URL  OR  --csv <file.csv>")
        return

    config = ScrapeConfig(
        profile_url=url,
        provider="gemini",
        model="gemini-2.5-flash",
        user_data_dir="linkedin_session",
        headless=True,
    )

    data = await scrape_linkedin(config)

    username = get_username_from_url(url)
    os.makedirs("data", exist_ok=True)
    file_path = f"data/{username}.json"

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data.model_dump(), f, indent=2, ensure_ascii=False)

    print(f"✅ Saved to {file_path}")


if __name__ == "__main__":
    asyncio.run(main())
