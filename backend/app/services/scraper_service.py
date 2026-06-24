import sys
import json
import csv
import asyncio
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT_DIR))

from linkedin_tool.extractor import scrape_from_csv
from app.state import RESULTS_DIR, append_log, get_settings, update_job


def count_csv_profiles(csv_path: str) -> int:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as file:
        return sum(1 for row in csv.DictReader(file) if (row.get("profile_url") or "").strip())


def csv_progress(csv_path: str) -> tuple[int, int, int]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as file:
        rows = [row for row in csv.DictReader(file) if (row.get("profile_url") or "").strip()]
    completed = sum(1 for row in rows if row.get("completed_at"))
    failed = sum(1 for row in rows if row.get("error") and not row.get("completed_at"))
    return len(rows), completed, failed


async def monitor_csv_progress(csv_path: str, job_id: str) -> None:
    last_progress = -1
    while True:
        total, completed, failed = csv_progress(csv_path)
        processed = completed + failed
        progress = 100 if total == 0 else min(99, int((processed / total) * 100))
        if progress != last_progress:
            update_job(
                job_id,
                progress=progress,
                completedProfiles=completed,
                failedProfiles=failed,
                totalProfiles=total,
            )
            append_log(job_id, "info", f"Progress {progress}% ({processed}/{total} processed)")
            last_progress = progress
        await asyncio.sleep(2)


async def run_csv_scraper(csv_path: str, job_id: str | None = None):
    settings = get_settings()
    output_dir = RESULTS_DIR
    output_dir.mkdir(exist_ok=True)

    if settings.get("apiKey"):
        if settings.get("apiProvider") == "openrouter":
            import os
            os.environ["OPENROUTER_API_KEY"] = settings["apiKey"]
        else:
            import os
            os.environ["GEMINI_API_KEY"] = settings["apiKey"]

    total_profiles = count_csv_profiles(csv_path)
    if job_id:
        append_log(job_id, "info", f"Starting scrape for {total_profiles} profile(s)")
        update_job(job_id, status="running", progress=1, totalProfiles=total_profiles)

    monitor_task = asyncio.create_task(monitor_csv_progress(csv_path, job_id)) if job_id else None
    try:
        await scrape_from_csv(
            csv_path=csv_path,
            user_data_dir=str(ROOT_DIR / "linkedin_session"),
            headless=bool(settings.get("headless", True)),
            output_dir=str(output_dir),
            profiles_config=None,
        )
    finally:
        if monitor_task:
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass

    all_files = sorted(
        output_dir.glob("*.json"),
        key=lambda file: file.stat().st_mtime,
        reverse=True,
    )

    profiles = []

    for file in all_files[:total_profiles]:
        with open(file, "r", encoding="utf-8") as f:
            profiles.append(json.load(f))

    if job_id:
        completed = len(profiles)
        failed = max(total_profiles - completed, 0)
        update_job(
            job_id,
            status="completed",
            progress=100,
            completedProfiles=completed,
            failedProfiles=failed,
            totalProfiles=total_profiles,
        )
        append_log(job_id, "success", f"Scraping completed: {completed}/{total_profiles} profile(s) extracted")

    return {
        "message": "SCRAPING COMPLETED",
        "total_profiles": len(profiles),
        "profiles": profiles
    }
