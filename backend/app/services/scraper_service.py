import sys
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT_DIR))

from linkedin_tool.extractor import scrape_from_csv

async def run_csv_scraper(csv_path: str):
    output_dir = ROOT_DIR / "data"
    output_dir.mkdir(exist_ok=True)

    before_files = set(output_dir.glob("*.json"))

    await scrape_from_csv(
        csv_path=csv_path,
        user_data_dir=str(ROOT_DIR / "linkedin_session"),
        headless=True,
        output_dir=str(output_dir),
        profiles_config=None,
    )

    after_files = set(output_dir.glob("*.json"))
    new_files = after_files - before_files

    profiles = []

    for file in new_files:
        with open(file, "r", encoding="utf-8") as f:
            profiles.append(json.load(f))

    return {
        "message": "SCRAPING COMPLETED",
        "total_profiles": len(profiles),
        "profiles": profiles
    }