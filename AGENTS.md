# AI Coding Agent Instructions

## Project overview
This repository is a LinkedIn profile extraction tool that uses Playwright to reuse authenticated browser sessions and an LLM to convert LinkedIn DOM snapshots into structured JSON.

## Key files
- `linkedin_tool/extractor.py`: core scraping and extraction orchestration.
- `linkedin_tool/main.py`: simple entrypoint that runs `linkedin_tool.extractor.main()`.
- `linkedin_tool/login_once.py`: helper script to save a valid LinkedIn session profile.
- `requirements.txt`: Python dependencies.

## Important behavior
- The extraction engine is designed around a strict LLM-based JSON parser.
- `linkedin_tool/extractor.py` builds a single prompt from LinkedIn snapshot sections and sends it to an LLM.
- The tool expects `GOOGLE_API_KEY` or `GEMINI_API_KEY` for Gemini, otherwise `OPENROUTER_API_KEY` for OpenRouter.
- Gemini is the primary provider in this codebase, using `GEMINI_MODEL = "gemini-2.5-flash-lite"`.
- The system prompt explicitly requires valid JSON only, no markdown, no explanations, and no hallucinations.

## Run modes
- Single-profile mode:
  - `python -m linkedin_tool.extractor <linkedin-profile-url>`
- Batch mode:
  - `python -m linkedin_tool.extractor --csv profiles.csv`
- Session capture:
  - `python -m linkedin_tool.login_once --user-data-dir linkedin_session`

## Data and configuration
- Output JSON files are written to `data/` by default.
- Batch mode reads rows from a CSV with a `profile_url` column and writes progress back to the CSV.
- Multi-profile scraping is supported via `--profiles-config` JSON containing browser profiles and optional proxy URLs.
- Session directories are stored under `linkedin_session/` by default.

## What to avoid
- Do not introduce broad refactors without preserving the strict JSON extraction contract.
- Do not change the Gemini/OpenRouter selection behavior unless the change is explicitly needed.
- Do not assume the profile data model includes fields beyond the schema defined in `linkedin_tool/extractor.py`.

## Helpful hints for AI agents
- Focus on stable behavior in `linkedin_tool/extractor.py` and the LLM prompt/response flow.
- Preserve the strict prompt schema and JSON-only output requirements.
- Prefer minimal, safe changes around session management, proxy handling, and error recovery.
