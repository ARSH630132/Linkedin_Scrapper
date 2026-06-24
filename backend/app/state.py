from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
STATE_DIR = ROOT_DIR / ".backend_state"
UPLOAD_DIR = STATE_DIR / "uploads"
RESULTS_DIR = ROOT_DIR / "data"
SESSIONS_DIR = ROOT_DIR / "linkedin_sessions"

JOBS_FILE = STATE_DIR / "jobs.json"
LOGS_FILE = STATE_DIR / "logs.json"
SETTINGS_FILE = STATE_DIR / "settings.json"
SESSIONS_FILE = STATE_DIR / "sessions.json"

DEFAULT_SETTINGS: dict[str, Any] = {
    "backendApiUrl": os.getenv("NEXT_PUBLIC_API_URL", "http://127.0.0.1:8000"),
    "apiProvider": "gemini",
    "apiKey": "",
    "maxParallelWorkers": 3,
    "headless": True,
    "retryCount": 2,
    "delayMinSeconds": 4,
    "delayMaxSeconds": 12,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    STATE_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    RESULTS_DIR.mkdir(exist_ok=True)
    SESSIONS_DIR.mkdir(exist_ok=True)


def read_json(path: Path, fallback: Any) -> Any:
    try:
        if not path.exists():
            return fallback
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def write_json(path: Path, payload: Any) -> None:
    ensure_dirs()
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def get_settings() -> dict[str, Any]:
    return {**DEFAULT_SETTINGS, **read_json(SETTINGS_FILE, {})}


def save_settings(settings: dict[str, Any]) -> dict[str, Any]:
    next_settings = {**DEFAULT_SETTINGS, **settings}
    write_json(SETTINGS_FILE, next_settings)
    return next_settings


def get_jobs() -> list[dict[str, Any]]:
    jobs = read_json(JOBS_FILE, [])
    return sorted(jobs, key=lambda job: job.get("createdAt", ""), reverse=True)


def save_jobs(jobs: list[dict[str, Any]]) -> None:
    write_json(JOBS_FILE, jobs)


def upsert_job(job: dict[str, Any]) -> dict[str, Any]:
    jobs = [item for item in get_jobs() if item.get("id") != job.get("id")]
    save_jobs([job, *jobs])
    return job


def update_job(job_id: str, **updates: Any) -> dict[str, Any] | None:
    next_job = None
    jobs = []
    for job in get_jobs():
        if job.get("id") == job_id:
            next_job = {**job, **updates, "updatedAt": utc_now()}
            jobs.append(next_job)
        else:
            jobs.append(job)
    save_jobs(jobs)
    return next_job


def get_logs(job_id: str | None = None) -> list[dict[str, Any]]:
    logs = read_json(LOGS_FILE, [])
    if job_id:
        logs = [log for log in logs if log.get("jobId") == job_id]
    return logs[-500:]


def append_log(job_id: str, level: str, message: str) -> dict[str, Any]:
    log = {
        "id": str(uuid.uuid4()),
        "jobId": job_id,
        "level": level,
        "message": message,
        "timestamp": utc_now(),
    }
    write_json(LOGS_FILE, [*get_logs(), log][-1000:])
    return log


def normalize_profile(raw: dict[str, Any], job_id: str, source_file: str = "") -> dict[str, Any]:
    current = raw.get("current_employment") or {}
    return {
        "id": raw.get("id") or source_file.replace(".json", "") or str(uuid.uuid4()),
        "jobId": job_id,
        "sourceFile": source_file,
        "profileUrl": raw.get("profile_url", ""),
        "full_name": raw.get("full_name", ""),
        "headline": raw.get("headline", ""),
        "location": raw.get("location", ""),
        "about": raw.get("about", ""),
        "current_employment": {
            "title": current.get("title", ""),
            "company": current.get("company", ""),
            "duration": current.get("duration", ""),
            "location": current.get("location", ""),
        },
        "experience": raw.get("experience") if isinstance(raw.get("experience"), list) else [],
        "education": raw.get("education") if isinstance(raw.get("education"), list) else [],
        "skills": raw.get("skills") if isinstance(raw.get("skills"), list) else [],
        "email": raw.get("email", ""),
        "status": "completed" if raw.get("full_name") else "failed",
        "error": raw.get("error", ""),
    }


def get_results(job_id: str = "all") -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for file_path in RESULTS_DIR.glob("*.json"):
        raw = read_json(file_path, {})
        if isinstance(raw, dict):
            results.append(normalize_profile(raw, job_id, file_path.name))
    return sorted(results, key=lambda profile: profile.get("full_name", ""))


def default_sessions() -> list[dict[str, Any]]:
    primary_dir = ROOT_DIR / "linkedin_session"
    return [{
        "id": "session_primary",
        "name": "primary",
        "userDataDir": str(primary_dir),
        "loginStatus": "logged_in" if primary_dir.exists() else "not_configured",
        "lastCheckedAt": utc_now(),
    }]


def get_sessions() -> list[dict[str, Any]]:
    sessions = read_json(SESSIONS_FILE, [])
    if sessions:
        return sessions
    sessions = default_sessions()
    write_json(SESSIONS_FILE, sessions)
    return sessions


def save_sessions(sessions: list[dict[str, Any]]) -> None:
    write_json(SESSIONS_FILE, sessions)
