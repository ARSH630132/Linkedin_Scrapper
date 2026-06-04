from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright


async def save_session(user_data_dir: str) -> None:
    profile_dir = Path(user_data_dir).resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            viewport={"width": 1366, "height": 900},
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )

        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://www.linkedin.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)

        print("\n👉 LinkedIn me login karo (agar already logged in ho to home/profile open hone do).")
        print("👉 Jab page fully load ho jaye, ENTER dabao...\n")
        await asyncio.to_thread(input)

        await page.wait_for_timeout(1200)
        cookies = await context.cookies("https://www.linkedin.com")
        has_li_at = any(c.get("name") == "li_at" and c.get("value") for c in cookies)

        await context.close()

    if has_li_at:
        print(f"✅ Session saved in: {profile_dir}")
    else:
        print(
            f"⚠️ Session folder save ho gaya, lekin 'li_at' cookie nahi mili: {profile_dir}\n"
            "Dubara run karke ensure karo ki LinkedIn account se actual login hua ho."
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-data-dir", default="linkedin_session_1")
    args = parser.parse_args()
    asyncio.run(save_session(args.user_data_dir))


if __name__ == "__main__":
    main()
