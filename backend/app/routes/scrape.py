from __future__ import annotations

import csv
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile

from app.services.scraper_service import count_csv_profiles, run_csv_scraper
from app.state import (
    RESULTS_DIR,
    ROOT_DIR,
    SESSIONS_DIR,
    UPLOAD_DIR,
    append_log,
    ensure_dirs,
    get_jobs,
    get_logs,
    get_results,
    get_sessions,
    get_settings,
    save_sessions,
    save_settings,
    upsert_job,
    utc_now,
    update_job,
)

router = APIRouter()


def _safe_name(name: str) -> str:
    cleaned = "".join(char for char in name.lower().strip().replace(" ", "-") if char.isalnum() or char in {"-", "_"})
    return cleaned or "profile"


async def _save_upload(file: UploadFile) -> Path:
    ensure_dirs()
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")
    path = UPLOAD_DIR / f"{uuid.uuid4()}_{Path(file.filename).name}"
    content = await file.read()
    path.write_bytes(content)
    return path


def _preview_csv(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if "profile_url" not in [field.strip() for field in (reader.fieldnames or [])]:
            raise HTTPException(status_code=400, detail="CSV must include a profile_url column")
        rows = []
        for index, row in enumerate(reader, start=2):
            profile_url = (row.get("profile_url") or "").strip()
            rows.append({
                "profile_url": profile_url,
                "rowNumber": index,
                "valid": "linkedin.com/in/" in profile_url.lower(),
                "reason": None if "linkedin.com/in/" in profile_url.lower() else "Invalid LinkedIn profile URL",
            })
    return rows


async def _run_job(job_id: str, csv_path: str) -> None:
    try:
        await run_csv_scraper(csv_path, job_id=job_id)
    except Exception as error:
        update_job(job_id, status="failed", progress=100)
        append_log(job_id, "error", str(error))


@router.get("/settings")
async def settings_get():
    return get_settings()


@router.post("/settings")
async def settings_post(settings: dict[str, Any]):
    return save_settings(settings)


@router.get("/settings/api-key-status")
async def api_key_status():
    settings = get_settings()
    api_key = settings.get("apiKey") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or os.getenv("OPENROUTER_API_KEY") or ""
    provider = settings.get("apiProvider", "gemini")
    logs = get_logs()
    last_api_error = next((log for log in reversed(logs) if "api" in log.get("message", "").lower() or "quota" in log.get("message", "").lower()), None)
    return {
        "provider": provider,
        "configured": bool(api_key),
        "maskedKey": f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "",
        "limitAvailable": False,
        "limitMessage": "Gemini/OpenRouter do not expose remaining quota through this scraper API. Check provider console for exact limits.",
        "lastApiError": last_api_error.get("message") if last_api_error else "",
    }


@router.post("/scraper/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    path = await _save_upload(file)
    rows = _preview_csv(path)
    valid_count = sum(1 for row in rows if row["valid"])
    return {
        "uploadId": path.name,
        "filename": file.filename,
        "rows": rows,
        "validCount": valid_count,
        "invalidCount": len(rows) - valid_count,
    }


@router.post("/scraper/start")
async def start_scraping(payload: dict[str, Any], background_tasks: BackgroundTasks):
    upload_id = payload.get("uploadId")
    if not upload_id:
        raise HTTPException(status_code=400, detail="uploadId is required")
    csv_path = UPLOAD_DIR / Path(upload_id).name
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded CSV not found")

    total = count_csv_profiles(str(csv_path))
    now = utc_now()
    job = {
        "id": f"job_{uuid.uuid4().hex[:10]}",
        "name": f"LinkedIn scrape {Path(upload_id).name}",
        "status": "running",
        "csvPath": str(csv_path),
        "progress": 0,
        "totalProfiles": total,
        "completedProfiles": 0,
        "failedProfiles": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    upsert_job(job)
    append_log(job["id"], "info", "Job queued")
    background_tasks.add_task(_run_job, job["id"], str(csv_path))
    return job


@router.post("/scrape/csv")
async def scrape_csv(file: UploadFile = File(...)):
    path = await _save_upload(file)
    result = await run_csv_scraper(str(path))
    return {"success": True, "file_path": str(path), "data": result}


@router.get("/scraper/jobs")
async def jobs():
    return get_jobs()


@router.get("/scraper/jobs/{job_id}")
async def job(job_id: str):
    found = next((item for item in get_jobs() if item.get("id") == job_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="Job not found")
    return found


@router.get("/scraper/logs/{job_id}")
async def logs(job_id: str):
    return get_logs(job_id)


@router.get("/scraper/results/{job_id}")
async def results(job_id: str):
    return get_results(job_id)


@router.get("/scraper/dashboard")
async def dashboard():
    jobs = get_jobs()
    total = sum(int(job.get("totalProfiles", 0)) for job in jobs)
    completed = sum(int(job.get("completedProfiles", 0)) for job in jobs)
    failed = sum(int(job.get("failedProfiles", 0)) for job in jobs)
    sessions = get_sessions()
    return {
        "totalProfiles": total,
        "completedProfiles": completed,
        "failedProfiles": failed,
        "pendingProfiles": max(total - completed - failed, 0),
        "activeSessions": sum(1 for session in sessions if session.get("loginStatus") == "logged_in"),
        "proxyHealth": 100,
    }


@router.post("/scraper/pause")
async def pause(payload: dict[str, Any]):
    job_id = payload.get("jobId")
    job = update_job(job_id, status="paused") if job_id else None
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    append_log(job_id, "warning", "Pause requested. Running browser work may finish current profile first.")
    return job


@router.post("/scraper/retry")
async def retry(payload: dict[str, Any], background_tasks: BackgroundTasks):
    job_id = payload.get("jobId")
    job = next((item for item in get_jobs() if item.get("id") == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    csv_path = job.get("csvPath")
    if not csv_path:
        raise HTTPException(status_code=400, detail="Job has no csvPath")
    next_job = update_job(job_id, status="running", progress=0, completedProfiles=0, failedProfiles=0)
    append_log(job_id, "info", "Retry requested")
    background_tasks.add_task(_run_job, job_id, csv_path)
    return next_job


@router.get("/sessions")
async def sessions_get():
    return get_sessions()


@router.post("/sessions/create")
async def sessions_create(payload: dict[str, Any]):
    name = _safe_name(payload.get("name", "profile"))
    session = {
        "id": f"session_{uuid.uuid4().hex[:10]}",
        "name": name,
        "userDataDir": str(SESSIONS_DIR / name),
        "loginStatus": "not_configured",
        "lastCheckedAt": utc_now(),
    }
    sessions = [item for item in get_sessions() if item.get("name") != name]
    save_sessions([*sessions, session])
    return session


@router.post("/sessions/login")
async def sessions_login(payload: dict[str, Any]):
    session_id = payload.get("sessionId")
    sessions = get_sessions()
    session = next((item for item in sessions if item.get("id") == session_id), None)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user_data_dir = session["userDataDir"]
    Path(user_data_dir).mkdir(parents=True, exist_ok=True)
    subprocess.Popen(
        [sys.executable, "-m", "linkedin_tool.login_once", "--user-data-dir", user_data_dir],
        cwd=str(ROOT_DIR),
        creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0,
    )
    updated = {**session, "loginStatus": "logged_in", "lastCheckedAt": utc_now()}
    save_sessions([updated if item.get("id") == session_id else item for item in sessions])
    return updated


@router.get("/proxies")
async def proxies_get():
    return []


@router.post("/proxies/test")
async def proxies_test(payload: dict[str, Any]):
    return {
        "id": f"proxy_{uuid.uuid4().hex[:8]}",
        "url": payload.get("proxyUrl", ""),
        "status": "untested",
        "lastTestedAt": utc_now(),
    }


@router.post("/proxies/assign")
async def proxies_assign(payload: dict[str, Any]):
    return {
        "id": f"proxy_{uuid.uuid4().hex[:8]}",
        "url": payload.get("proxyId", ""),
        "status": "untested",
        "assignedSession": payload.get("sessionId", ""),
        "lastTestedAt": utc_now(),
    }
