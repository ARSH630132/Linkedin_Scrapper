from __future__ import annotations
import time
from typing import Optional

import asyncio
import argparse
import csv
import json
import os
import random
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote, urlparse, urlunparse

import requests
from playwright.async_api import (
    Error as PlaywrightError,
)
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError

load_dotenv()


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
    user_data_dir: str = "linkedin_session"
    headless: bool = False
    proxy_url: str | None = None


@dataclass
class BrowserProfileConfig:
    name: str
    user_data_dir: str
    proxy_url: str | None = None


INACCESSIBLE_ERROR_MARKERS = (
    "ERR_TUNNEL_CONNECTION_FAILED",
    "ERR_SSL_PROTOCOL_ERROR",
    "ERR_PROXY_CONNECTION_FAILED",
    "ERR_SOCKS_CONNECTION_FAILED",
    "ERR_CONNECTION_CLOSED",
    "ERR_CONNECTION_RESET",
    "ERR_TIMED_OUT",
    "LinkedIn blocked/redirected the session",
)

GEMINI_MODEL = "gemini-2.5-flash-lite"
OPENROUTER_MODEL = "google/gemini-2.5-flash-lite"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
PROXY_POOL_PATH = "proxies.txt"
PROXY_POOL_URL = "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/US/proxies.txt"


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
    def get_completion(self, prompt: str, system_prompt: str) -> str:
        from google import genai

        google_api_key = os.environ.get("GOOGLE_API_KEY")
        gemini_api_key = os.environ.get("GEMINI_API_KEY")

        api_key = google_api_key or gemini_api_key
        if not api_key:
            raise RuntimeError("Missing GOOGLE_API_KEY/GEMINI_API_KEY.")

        if google_api_key and gemini_api_key:
            print("Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.")
        elif gemini_api_key and not google_api_key:
            print("Using GEMINI_API_KEY.")

        client = genai.Client(api_key=api_key)
        combined_prompt = f"{system_prompt}\n\n{prompt}"

        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=combined_prompt,
                    config={"response_mime_type": "application/json"},
                )
                text = getattr(response, "text", None)
                if text and text.strip():
                    return text.strip()
                raise RuntimeError("Gemini returned empty response.")
            except Exception as e:
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
                raise


class OpenRouterProvider(LLMProvider):

    def get_completion(self, prompt: str, system_prompt: str) -> str:
        from openai import OpenAI

        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY is missing.")

        client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL)
        resp = client.chat.completions.create(
            model=OPENROUTER_MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        content = resp.choices[0].message.content
        if not content:
            raise RuntimeError("OpenRouter returned empty response.")
        return content


def _llm_provider() -> LLMProvider:
    if os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"):
        return GeminiProvider()
    if os.environ.get("OPENROUTER_API_KEY"):
        return OpenRouterProvider()
    raise RuntimeError("Missing GOOGLE_API_KEY/GEMINI_API_KEY or OPENROUTER_API_KEY.")


def _proxy_options(proxy_url: str | None) -> dict[str, str] | None:
    if not proxy_url:
        return None

    parsed = urlparse(proxy_url)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError("Proxy URL must include a scheme and host, e.g. http://user:pass@host:port")

    server = f"{parsed.scheme}://{parsed.hostname}"
    if parsed.port:
        server = f"{server}:{parsed.port}"

    proxy: dict[str, str] = {"server": server}
    if parsed.username:
        proxy["username"] = unquote(parsed.username)
    if parsed.password:
        proxy["password"] = unquote(parsed.password)
    return proxy


def _persistent_context_options(
    *,
    user_data_dir: str,
    headless: bool,
    proxy_url: str | None,
) -> dict[str, Any]:
    options: dict[str, Any] = {
        "user_data_dir": user_data_dir,
        "headless": headless,
        "viewport": {"width": 1366, "height": 900},
        "args": ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    }
    proxy = _proxy_options(proxy_url)
    if proxy:
        options["proxy"] = proxy
    return options


def _load_proxy_pool(proxy_pool_path: str | None) -> list[str]:
    if not proxy_pool_path:
        return []

    path = Path(proxy_pool_path)
    if not path.exists():
        raise FileNotFoundError(f"Proxy pool file not found: {proxy_pool_path}")

    proxies: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        proxy_url = line.strip()
        if not proxy_url or proxy_url.startswith("#"):
            continue
        parsed = urlparse(proxy_url)
        if parsed.scheme.lower() != "socks5":
            continue
        _proxy_options(proxy_url)
        proxies.append(proxy_url)

    if not proxies:
        raise ValueError(f"Proxy pool file has no usable socks5 proxies: {proxy_pool_path}")
    return proxies


def _fetch_txt_to_file(raw_url: str, save_path: str) -> None:
    response = requests.get(raw_url, timeout=30)
    if response.status_code != 200:
        raise RuntimeError(f"Failed to fetch proxy pool. Status code: {response.status_code}")

    path = Path(save_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(response.text, encoding="utf-8")
    print(f"File saved to: {path}")


def _proxy_iplocate_check(proxy_url: str, timeout_s: float = 12.0) -> bool:
    proxies = {"http": proxy_url, "https": proxy_url}
    try:
        response = requests.get("http://api.iplocate.io/ip", proxies=proxies, timeout=timeout_s)
        return response.status_code == 200 and bool(response.text.strip())
    except requests.RequestException:
        return False


def _redact_proxy_url(proxy_url: str) -> str:
    parsed = urlparse(proxy_url)
    netloc = parsed.hostname or ""
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, "", "", "", ""))


def _is_inaccessible_error(error: Exception) -> bool:
    error_text = str(error)
    return any(marker in error_text for marker in INACCESSIBLE_ERROR_MARKERS)


def _assigned_proxy_urls(profiles: list[BrowserProfileConfig], exclude_name: str | None = None) -> set[str]:
    return {
        profile.proxy_url
        for profile in profiles
        if profile.proxy_url and profile.name != exclude_name
    }


def _persist_profile_proxy(
    *,
    profiles_config_path: str,
    profile_name: str,
    proxy_url: str,
) -> None:
    path = Path(profiles_config_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw_profiles = payload.get("profiles")
    if not isinstance(raw_profiles, list):
        raise ValueError("profiles config must contain a 'profiles' list")

    updated = False
    for raw_profile in raw_profiles:
        if isinstance(raw_profile, dict) and raw_profile.get("name") == profile_name:
            raw_profile["proxy_url"] = proxy_url
            updated = True
            break

    if not updated:
        raise ValueError(f"Could not find profile '{profile_name}' in {profiles_config_path}")

    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"   💾 updated {profiles_config_path} for profile '{profile_name}'")


async def _repair_profile_proxy(
    *,
    profile: BrowserProfileConfig,
    profiles: list[BrowserProfileConfig],
    profiles_config_path: str | None,
    proxy_pool_path: str | None,
    proxy_pool_url: str | None,
    proxy_lock: asyncio.Lock,
) -> BrowserProfileConfig | None:
    if not profiles_config_path or not proxy_pool_path:
        return None

    async with proxy_lock:
        used_proxies = _assigned_proxy_urls(profiles, exclude_name=profile.name)
        if profile.proxy_url:
            works = await asyncio.to_thread(_proxy_iplocate_check, profile.proxy_url)
            if works:
                print(f"   ✅ current proxy still passes check: {_redact_proxy_url(profile.proxy_url)}")
                return profile
            print(f"   ⚠️ current proxy failed check: {_redact_proxy_url(profile.proxy_url)}")
            used_proxies.add(profile.proxy_url)

        try:
            proxy_pool = _load_proxy_pool(proxy_pool_path)
            proxy_url = await _find_working_proxy_without_lock(proxy_pool, used_proxies)
        except (FileNotFoundError, ValueError):
            proxy_url = None

        if not proxy_url and proxy_pool_url:
            print("   🔄 fetching proxy pool fallback...")
            _fetch_txt_to_file(proxy_pool_url, proxy_pool_path)
            proxy_pool = _load_proxy_pool(proxy_pool_path)
            proxy_url = await _find_working_proxy_without_lock(proxy_pool, used_proxies)

        if not proxy_url:
            return None

        repaired = BrowserProfileConfig(
            name=profile.name,
            user_data_dir=profile.user_data_dir,
            proxy_url=proxy_url,
        )
        _persist_profile_proxy(
            profiles_config_path=profiles_config_path,
            profile_name=profile.name,
            proxy_url=proxy_url,
        )
        return repaired


async def _find_working_proxy_without_lock(
    proxy_pool: list[str],
    used_proxies: set[str],
) -> str | None:
    for proxy_url in proxy_pool:
        if proxy_url in used_proxies:
            continue
        print(f"   🔌 checking proxy candidate: {_redact_proxy_url(proxy_url)}")
        works = await asyncio.to_thread(_proxy_iplocate_check, proxy_url)
        if works:
            used_proxies.add(proxy_url)
            print(f"   ✅ proxy selected: {_redact_proxy_url(proxy_url)}")
            return proxy_url
        print(f"   ⚠️ proxy failed iplocate check: {_redact_proxy_url(proxy_url)}")
    return None


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
    "div_ph5": "div.ph5",
    "experience_section": "section[id*='experience']",
    "education_section": "section[id*='education']",
    "profile_image": "img.pv-top-card-profile-picture__image",
}

PROFILE_TEXT_SIGNALS = ("experience", "education", "about", "activity", "skills")
AUTH_TEXT_SIGNALS = (
    "join linkedin",
    "sign in",
    "authwall",
    "verify your identity",
    "security verification",
)


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
    if not text:
        return False
    t = re.sub(r"\s+", " ", text.strip().lower())
    patterns = ("see more", "show more", "more", "show all", "view more")
    return any(p in t for p in patterns)


def _has_profile_text_signals(body_text: str) -> bool:
    lowered = re.sub(r"\s+", " ", (body_text or "").lower())
    if any(signal in lowered for signal in AUTH_TEXT_SIGNALS):
        return False
    signal_count = sum(1 for signal in PROFILE_TEXT_SIGNALS if signal in lowered)
    return signal_count >= 2


async def _wait_for_profile_loaded(page: Any) -> dict[str, Any]:
    """
    Staged profile readiness:
    Stage 1: wait for domcontentloaded
    Stage 2: human-like delay (2-4s)
    Stage 3: adaptive multi-signal detection loop (every 2s, max 35s)

    Readiness is true when profile-specific selectors appear, OR
    fallback text contains multiple profile section signals.
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

        fallback_profile = (
            "/in/" in current_url.lower()
            and body_len > 2000
            and _has_profile_text_signals(body_text)
        )

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
                reason = "fallback: URL contains /in/ and profile section text signals"

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


async def _prepare_and_capture_snapshot(
    page: Any,
    profile_url: str,
    required_signal: Literal["experience", "education"] | None = "experience",
) -> dict[str, str]:
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

        signal_present = True
        if required_signal == "experience":
            signal_present = await _has_experience_signal(page)
        elif required_signal == "education":
            try:
                signal_present = await page.locator(SECTION_SELECTORS["education"]).count() > 0
            except PlaywrightError:
                signal_present = False
            if not signal_present:
                try:
                    body_text = await page.locator("body").inner_text()
                    signal_present = "education" in (body_text or "").lower()
                except PlaywrightError:
                    signal_present = False

        too_small = _snapshot_is_too_small(snap)

        if not too_small and signal_present:
            return snap

        reason = []
        if too_small:
            reason.append("snapshot too small")
        if not signal_present and required_signal:
            reason.append(f"{required_signal} section missing")
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

def normalize_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("www."):
        return "https://" + url
    if not url.startswith("http"):
        return "https://" + url
    return url


def _profile_base_url(profile_url: str) -> str:
    parsed = urlparse(profile_url)
    path = parsed.path.rstrip("/")
    return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))


def _profile_detail_url(profile_url: str, detail_name: Literal["experience", "education"]) -> str:
    return f"{_profile_base_url(profile_url)}/details/{detail_name}/"


async def _scrape_snapshot_on_page(
    page: Any,
    url: str,
    label: str,
    required_signal: Literal["experience", "education"] | None,
) -> dict[str, str]:
    print(f"   📄 opening {label}: {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(random.randint(700, 1600))

    await _detect_and_raise_if_blocked(page)
    return await _prepare_and_capture_snapshot(page, profile_url=url, required_signal=required_signal)


async def _scrape_profile_on_page(page: Any, profile_url: str) -> dict[str, dict[str, str]]:
    main_snap = await _scrape_snapshot_on_page(
        page,
        profile_url,
        label="main profile",
        required_signal=None,
    )
    await _human_pause(1.5, 4.0)

    experience_url = _profile_detail_url(profile_url, "experience")
    experience_snap = await _scrape_snapshot_on_page(
        page,
        experience_url,
        label="experience detail",
        required_signal="experience",
    )
    await _human_pause(1.5, 4.0)

    education_url = _profile_detail_url(profile_url, "education")
    education_snap = await _scrape_snapshot_on_page(
        page,
        education_url,
        label="education detail",
        required_signal="education",
    )

    return {
        "main": main_snap,
        "experience_detail": experience_snap,
        "education_detail": education_snap,
    }


async def scrape_linkedin(config: ScrapeConfig) -> ProfileData:
    """Backwards-compatible single-profile scrape (unchanged signature)."""
    provider = _llm_provider()

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            **_persistent_context_options(
                user_data_dir=config.user_data_dir,
                headless=config.headless,
                proxy_url=config.proxy_url,
            )
        )
        page = context.pages[0] if context.pages else await context.new_page()

        try:
            snap = await _scrape_profile_on_page(page, normalize_url(config.profile_url))
        finally:
            await context.close()

    try:
        raw = provider.get_completion(prompt=_build_llm_prompt(snap), system_prompt=SYSTEM_PROMPT)
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


def _read_csv_rows(csv_path: str) -> tuple[list[dict], list[str]]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = [(name or "").strip().lower() for name in (reader.fieldnames or [])]
        rows = []
        for r in reader:
            # normalize keys
            normalized = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
            rows.append(normalized)
        return rows, fieldnames


def _write_csv_rows(csv_path: str, rows: list[dict], fieldnames: list[str]) -> None:
    required_fields = ["profile_url", "assigned_profile", "completed_at", "error"]
    output_fields = [field for field in fieldnames if field]
    for field in required_fields:
        if field not in output_fields:
            output_fields.append(field)

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=output_fields)
        writer.writeheader()
        for r in rows:
            writer.writerow({field: r.get(field, "") for field in output_fields})


def _utc_timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _format_snapshot_for_prompt(title: str, snap: dict[str, str]) -> str:
    return (
        f"{title}\n"
        f"URL:\n{snap['url']}\n\n"
        f"TEXT:\n{snap['main_text']}\n\n"
        f"BODY_TEXT:\n{snap['body_text']}\n\n"
        f"HTML:\n{snap['html']}\n"
    )


def _build_llm_prompt(snap: dict[str, dict[str, str]]) -> str:
    return "\n\n".join([
        "Extract profile data from these already-loaded LinkedIn snapshots.",
        "Use MAIN_PROFILE for top-card, headline, location, about, skills, and any visible current employment.",
        "Use EXPERIENCE_DETAIL as the primary source for experience and current_employment.",
        "Use EDUCATION_DETAIL as the primary source for education.",
        _format_snapshot_for_prompt("MAIN_PROFILE", snap["main"]),
        _format_snapshot_for_prompt("EXPERIENCE_DETAIL", snap["experience_detail"]),
        _format_snapshot_for_prompt("EDUCATION_DETAIL", snap["education_detail"]),
    ])


def _extract_profile_data_from_snapshot(llm: LLMProvider, snap: dict[str, dict[str, str]]) -> ProfileData:
    raw = llm.get_completion(prompt=_build_llm_prompt(snap), system_prompt=SYSTEM_PROMPT)
    return _to_profile_data(raw)


def _load_profile_configs(config_path: str | None, fallback_user_data_dir: str) -> list[BrowserProfileConfig]:
    if not config_path:
        return [BrowserProfileConfig(name="primary", user_data_dir=fallback_user_data_dir)]

    with open(config_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    raw_profiles = payload.get("profiles")
    if not isinstance(raw_profiles, list) or not raw_profiles:
        raise ValueError("profiles config must contain a non-empty 'profiles' list")

    profiles: list[BrowserProfileConfig] = []
    seen_names: set[str] = set()
    seen_dirs: set[str] = set()
    seen_proxies: set[str] = set()

    for idx, raw in enumerate(raw_profiles, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"profile #{idx} must be an object")

        name = str(raw.get("name") or f"profile_{idx}").strip()
        user_data_dir = str(raw.get("user_data_dir") or "").strip()
        proxy_url = raw.get("proxy_url")
        proxy_url = str(proxy_url).strip() if proxy_url else None

        if not user_data_dir:
            raise ValueError(f"profile '{name}' is missing user_data_dir")
        if name in seen_names:
            raise ValueError(f"duplicate profile name: {name}")
        if user_data_dir in seen_dirs:
            raise ValueError(f"duplicate user_data_dir: {user_data_dir}")
        _proxy_options(proxy_url)
        if proxy_url:
            if proxy_url in seen_proxies:
                raise ValueError(f"duplicate proxy_url assigned in profiles config: {_redact_proxy_url(proxy_url)}")
            seen_proxies.add(proxy_url)

        seen_names.add(name)
        seen_dirs.add(user_data_dir)
        profiles.append(BrowserProfileConfig(name=name, user_data_dir=user_data_dir, proxy_url=proxy_url))

    return profiles


def _assign_pending_rows(rows: list[dict], profiles: list[BrowserProfileConfig]) -> dict[str, list[int]]:
    assignments = {profile.name: [] for profile in profiles}
    pending_indexes = [
        idx
        for idx, row in enumerate(rows)
        if row.get("profile_url") and not row.get("completed_at")
    ]
    if not pending_indexes:
        return assignments

    base_size, extra = divmod(len(pending_indexes), len(profiles))
    offset = 0
    for profile_index, profile in enumerate(profiles):
        chunk_size = base_size + (1 if profile_index < extra else 0)
        chunk = pending_indexes[offset:offset + chunk_size]
        assignments[profile.name] = chunk
        for row_idx in chunk:
            rows[row_idx]["assigned_profile"] = profile.name
            rows[row_idx]["error"] = ""
        offset += chunk_size

    return assignments


async def _persist_csv_rows(
    *,
    csv_path: str,
    rows: list[dict],
    fieldnames: list[str],
    csv_lock: asyncio.Lock,
) -> None:
    async with csv_lock:
        _write_csv_rows(csv_path, rows, fieldnames)


async def _scrape_profile_assignment(
    *,
    playwright: Any,
    profile: BrowserProfileConfig,
    profiles: list[BrowserProfileConfig],
    row_indexes: list[int],
    rows: list[dict],
    fieldnames: list[str],
    csv_path: str,
    csv_lock: asyncio.Lock,
    proxy_lock: asyncio.Lock,
    llm: LLMProvider,
    headless: bool,
    output_dir: str,
    profiles_config_path: str | None,
) -> None:
    if not row_indexes:
        print(f"\n[{profile.name}] no pending rows assigned")
        return

    async def launch_context() -> tuple[Any, Any]:
        context = await playwright.chromium.launch_persistent_context(
            **_persistent_context_options(
                user_data_dir=profile.user_data_dir,
                headless=headless,
                proxy_url=profile.proxy_url,
            )
        )
        page = context.pages[0] if context.pages else await context.new_page()
        return context, page

    def replace_shared_profile(repaired_profile: BrowserProfileConfig) -> None:
        for idx, existing_profile in enumerate(profiles):
            if existing_profile.name == repaired_profile.name:
                profiles[idx] = repaired_profile
                return

    print(f"\n[{profile.name}] starting {len(row_indexes)} assigned profile(s)")
    context, page = await launch_context()

    # warm-up: behave like a human landing on LinkedIn
    await _simulate_feed_browsing(page)

    try:
        for position, row_index in enumerate(row_indexes, start=1):
            row = rows[row_index]
            csv_position = row_index + 1
            total_assigned = len(row_indexes)
            url = normalize_url(row.get("profile_url", ""))
            if not url:
                continue

            print(f"\n[{profile.name} {position}/{total_assigned} | row {csv_position}] 🔎 scraping: {url}")

            try:
                try:
                    snap = await _scrape_profile_on_page(page, url)
                except Exception as first_error:
                    if not _is_inaccessible_error(first_error):
                        raise

                    print("   ⚠️ LinkedIn/page inaccessible; checking assigned proxy...")
                    repaired_profile = await _repair_profile_proxy(
                        profile=profile,
                        profiles=profiles,
                        profiles_config_path=profiles_config_path,
                        proxy_pool_path=PROXY_POOL_PATH,
                        proxy_pool_url=PROXY_POOL_URL,
                        proxy_lock=proxy_lock,
                    )
                    if not repaired_profile:
                        raise first_error

                    await context.close()
                    profile = repaired_profile
                    replace_shared_profile(repaired_profile)
                    context, page = await launch_context()
                    print("   🔁 retrying row once after proxy check/repair...")
                    snap = await _scrape_profile_on_page(page, url)

                data = _extract_profile_data_from_snapshot(llm, snap)
            except Exception as e:
                error = str(e)
                print(f"   ❌ scrape/extract error: {error}")
                row["error"] = error
                row["completed_at"] = ""
                await _persist_csv_rows(
                    csv_path=csv_path,
                    rows=rows,
                    fieldnames=fieldnames,
                    csv_lock=csv_lock,
                )
                continue

            username = get_username_from_url(url)
            file_path = os.path.join(output_dir, f"{username}.json")
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data.model_dump(), f, indent=2, ensure_ascii=False)
            print(f"   ✅ saved {file_path}")

            # mark completed + persist CSV after every profile
            row["assigned_profile"] = profile.name
            row["completed_at"] = _utc_timestamp()
            row["error"] = ""
            await _persist_csv_rows(
                csv_path=csv_path,
                rows=rows,
                fieldnames=fieldnames,
                csv_lock=csv_lock,
            )

            # human noise between profiles
            if position < total_assigned:
                # occasionally browse feed
                if random.random() < 0.35:
                    await _simulate_feed_browsing(page)
                await _human_pause(4.0, 12.0)
    finally:
        await context.close()


async def scrape_from_csv(
    csv_path: str,
    user_data_dir: str = "linkedin_session",
    headless: bool = False,
    output_dir: str = "data",
    profiles_config: str | None = None,
) -> None:
    rows, fieldnames = _read_csv_rows(csv_path)
    if not rows:
        print(f"❌ No rows in {csv_path}")
        return

    os.makedirs(output_dir, exist_ok=True)
    llm = _llm_provider()
    profiles = _load_profile_configs(profiles_config, fallback_user_data_dir=user_data_dir)
    assignments = _assign_pending_rows(rows, profiles)
    _write_csv_rows(csv_path, rows, fieldnames)
    csv_lock = asyncio.Lock()
    proxy_lock = asyncio.Lock()

    async with async_playwright() as p:
        workers = [
            _scrape_profile_assignment(
                playwright=p,
                profile=profile,
                profiles=profiles,
                row_indexes=assignments.get(profile.name, []),
                rows=rows,
                fieldnames=fieldnames,
                csv_path=csv_path,
                csv_lock=csv_lock,
                proxy_lock=proxy_lock,
                llm=llm,
                headless=headless,
                output_dir=output_dir,
                profiles_config_path=profiles_config,
            )
            for profile in profiles
        ]

        if len(profiles) > 1:
            print(f"\n⚡ running {len(profiles)} browser profile workers in parallel")
            await asyncio.gather(*workers)
        else:
            for worker in workers:
                await worker

        total = len(rows)
        completed = sum(1 for row in rows if row.get("completed_at"))
        failed = sum(1 for row in rows if row.get("error") and not row.get("completed_at"))
        print(f"\n✅ batch finished | rows={total} completed={completed} failed={failed}")


# =========================
# CLI
# =========================

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", help="LinkedIn profile URL for single-profile mode")
    parser.add_argument("--csv", dest="csv_path", help="CSV file with a profile_url column")
    parser.add_argument("--profiles-config", help="JSON config for one or more browser profiles")
    parser.add_argument("--user-data-dir", default="linkedin_session")
    parser.add_argument("--output-dir", default="data")
    parser.add_argument("--headless", choices=["true", "false"], default="true")
    parser.add_argument("--proxy-url", help="Proxy URL for single-profile mode")
    args = parser.parse_args()

    headless = args.headless == "true"

    # CSV mode: python -m linkedin_tool.extractor --csv profiles.csv
    if args.csv_path:
        await scrape_from_csv(
            csv_path=args.csv_path,
            user_data_dir=args.user_data_dir,
            headless=headless,
            output_dir=args.output_dir,
            profiles_config=args.profiles_config,
        )
        return

    # Original manual single-URL mode (unchanged behavior)
    if not args.url:
        print("❌ Please provide LinkedIn URL  OR  --csv <file.csv>")
        return

    config = ScrapeConfig(
        profile_url=args.url,
        user_data_dir=args.user_data_dir,
        headless=headless,
        proxy_url=args.proxy_url,
    )

    data = await scrape_linkedin(config)

    username = get_username_from_url(args.url)
    os.makedirs(args.output_dir, exist_ok=True)
    file_path = os.path.join(args.output_dir, f"{username}.json")

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data.model_dump(), f, indent=2, ensure_ascii=False)

    print(f"✅ Saved to {file_path}")


if __name__ == "__main__":
    asyncio.run(main())
