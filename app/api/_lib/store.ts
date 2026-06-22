import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { BrowserSession, CsvPreviewRow, ProfileResult, ProxyItem, ScrapeJob, ScrapeLog, Settings } from "@/types";

export const rootDir = process.cwd();
export const dashboardDir = join(rootDir, ".dashboard");
export const uploadsDir = join(dashboardDir, "uploads");
export const jobsFile = join(dashboardDir, "jobs.json");
export const logsFile = join(dashboardDir, "logs.json");
export const settingsFile = join(dashboardDir, "settings.json");
export const sessionsFile = join(dashboardDir, "sessions.json");

export const defaultSettings: Settings = {
  backendApiUrl: "",
  apiProvider: "gemini",
  apiKey: "",
  maxParallelWorkers: 3,
  headless: true,
  retryCount: 2,
  delayMinSeconds: 4,
  delayMaxSeconds: 12
};

export function ensureDashboardDirs() {
  mkdirSync(dashboardDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(filePath: string, payload: T) {
  ensureDashboardDirs();
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export function getSettings() {
  return { ...defaultSettings, ...readJson<Partial<Settings>>(settingsFile, {}) };
}

export function saveSettings(settings: Settings) {
  writeJson(settingsFile, settings);
  return settings;
}

export function getJobs() {
  return readJson<ScrapeJob[]>(jobsFile, []).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function saveJobs(jobs: ScrapeJob[]) {
  writeJson(jobsFile, jobs);
}

export function getLogs() {
  return readJson<ScrapeLog[]>(logsFile, []);
}

export function appendLog(jobId: string, level: ScrapeLog["level"], message: string) {
  const logs = getLogs();
  logs.push({ id: crypto.randomUUID(), jobId, level, message, timestamp: new Date().toISOString() });
  writeJson(logsFile, logs.slice(-1000));
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((item) => item.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""]));
  });
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function validateProfileRows(rows: Record<string, string>[]): CsvPreviewRow[] {
  const linkedinPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[^/\s?]+/i;
  return rows.map((row, index) => {
    const profileUrl = row.profile_url ?? "";
    const valid = linkedinPattern.test(profileUrl);
    return { profile_url: profileUrl, rowNumber: index + 2, valid, reason: valid ? undefined : "Invalid LinkedIn profile URL" };
  });
}

export function getResults(jobId = "all"): ProfileResult[] {
  const dataDir = join(rootDir, "data");
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const filePath = join(dataDir, file);
      const raw = readJson<Record<string, unknown>>(filePath, {});
      return normalizeProfile(raw, file, jobId);
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

function normalizeProfile(raw: Record<string, unknown>, sourceFile: string, jobId: string): ProfileResult {
  const current = (raw.current_employment ?? {}) as Record<string, string>;
  return {
    id: sourceFile.replace(/\.json$/, ""),
    jobId,
    sourceFile,
    profileUrl: "",
    full_name: String(raw.full_name ?? ""),
    headline: String(raw.headline ?? ""),
    location: String(raw.location ?? ""),
    about: String(raw.about ?? ""),
    current_employment: {
      title: String(current.title ?? ""),
      company: String(current.company ?? ""),
      duration: String(current.duration ?? ""),
      location: String(current.location ?? "")
    },
    experience: Array.isArray(raw.experience) ? raw.experience as ProfileResult["experience"] : [],
    education: Array.isArray(raw.education) ? raw.education as ProfileResult["education"] : [],
    skills: Array.isArray(raw.skills) ? raw.skills.map(String) : [],
    status: "completed"
  };
}

export function getSessions(): BrowserSession[] {
  const saved = readJson<BrowserSession[]>(sessionsFile, []);
  if (saved.length) return saved;
  const defaults: BrowserSession[] = ["primary", "secondary", "tertiary"].map((name) => {
    const userDataDir = name === "primary" ? "linkedin_session" : `linkedin_sessions/${name}`;
    const exists = existsSync(join(rootDir, userDataDir));
    return {
      id: `session_${name}`,
      name,
      userDataDir,
      loginStatus: exists ? "logged_in" : "not_configured",
      lastCheckedAt: new Date().toISOString()
    };
  });
  saveSessions(defaults);
  return defaults;
}

export function saveSessions(sessions: BrowserSession[]) {
  writeJson(sessionsFile, sessions);
}

export function getProxies(): ProxyItem[] {
  const proxyFile = join(rootDir, "proxies.txt");
  if (!existsSync(proxyFile)) return [];
  return readFileSync(proxyFile, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((url, index) => ({ id: `proxy_${index + 1}`, url, status: "untested" as const }));
}

export function addProxy(proxy: ProxyItem) {
  const proxyFile = join(rootDir, "proxies.txt");
  const existing = existsSync(proxyFile) ? readFileSync(proxyFile, "utf-8").trim() : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  if (!lines.includes(proxy.url)) writeFileSync(proxyFile, [...lines, proxy.url].join("\n") + "\n", "utf-8");
}

export function profilesCsvStats() {
  const csvPath = join(rootDir, "profiles.csv");
  if (!existsSync(csvPath)) return { total: 0, completed: 0, failed: 0 };
  const rows = parseCsv(readFileSync(csvPath, "utf-8"));
  return {
    total: rows.length,
    completed: rows.filter((row) => row.completed_at).length,
    failed: rows.filter((row) => row.error && !row.completed_at).length
  };
}

export function spawnScraper(job: ScrapeJob, csvPath: string) {
  const settings = getSettings();
  const env = { ...process.env };
  if (settings.apiKey) {
    if (settings.apiProvider === "gemini") {
      env.GEMINI_API_KEY = settings.apiKey;
    } else {
      env.OPENROUTER_API_KEY = settings.apiKey;
    }
  }
  const args = ["-m", "linkedin_tool.extractor", "--csv", csvPath, "--output-dir", "data", "--headless", String(settings.headless)];
  const child = spawn("python", args, { cwd: rootDir, env, shell: process.platform === "win32" });
  if (child.pid) {
    const jobs = getJobs();
    saveJobs(jobs.map((item) => item.id === job.id ? { ...item, processId: child.pid, csvPath, updatedAt: new Date().toISOString() } : item));
  }

  appendLog(job.id, "info", `Started scraper: python ${args.join(" ")}`);
  child.stdout.on("data", (chunk) => appendLog(job.id, "info", String(chunk).trim()));
  child.stderr.on("data", (chunk) => appendLog(job.id, "error", String(chunk).trim()));
  child.on("exit", (code) => {
    const jobs = getJobs();
    const nextJobs = jobs.map((item) => item.id === job.id ? { ...item, status: code === 0 ? "completed" as const : "failed" as const, progress: code === 0 ? 100 : item.progress, updatedAt: new Date().toISOString() } : item);
    saveJobs(nextJobs);
    appendLog(job.id, code === 0 ? "success" : "error", `Scraper exited with code ${code ?? "unknown"}`);
  });
}

export function fileModifiedIso(relativePath: string) {
  const path = join(rootDir, relativePath);
  return existsSync(path) ? statSync(path).mtime.toISOString() : new Date().toISOString();
}
