import type {
  BrowserSession,
  DashboardMetrics,
  ProfileResult,
  ProxyItem,
  ScrapeJob,
  ScrapeLog,
  Settings,
  StartScrapePayload,
  UploadCsvResponse
} from "@/types";

const defaultSettings: Settings = {
  backendApiUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL || "",
  apiProvider: "gemini",
  apiKey: "",
  maxParallelWorkers: 3,
  headless: true,
  retryCount: 2,
  delayMinSeconds: 4,
  delayMaxSeconds: 12
};

const now = new Date();
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

const mockJobs: ScrapeJob[] = [
  {
    id: "job_1027",
    name: "Recruiter Batch - Product Engineers",
    status: "running",
    progress: 68,
    totalProfiles: 150,
    completedProfiles: 102,
    failedProfiles: 4,
    createdAt: iso(142),
    updatedAt: iso(2)
  },
  {
    id: "job_1026",
    name: "Campus Leads",
    status: "completed",
    progress: 100,
    totalProfiles: 78,
    completedProfiles: 75,
    failedProfiles: 3,
    createdAt: iso(960),
    updatedAt: iso(720)
  },
  {
    id: "job_1025",
    name: "Design Sourcers",
    status: "failed",
    progress: 34,
    totalProfiles: 42,
    completedProfiles: 13,
    failedProfiles: 6,
    createdAt: iso(1320),
    updatedAt: iso(1180)
  }
];

const mockSessions: BrowserSession[] = [
  { id: "session_primary", name: "primary", userDataDir: "linkedin_session", loginStatus: "logged_in", proxyAssigned: "socks5://172.67.1.10:1080", lastCheckedAt: iso(12) },
  { id: "session_secondary", name: "secondary", userDataDir: "linkedin_sessions/secondary", loginStatus: "expired", proxyAssigned: "socks5://104.21.44.18:1080", lastCheckedAt: iso(84) },
  { id: "session_tertiary", name: "tertiary", userDataDir: "linkedin_sessions/tertiary", loginStatus: "not_configured", lastCheckedAt: iso(360) }
];

const mockProxies: ProxyItem[] = [
  { id: "proxy_1", url: "socks5://172.67.1.10:1080", status: "working", latencyMs: 214, assignedSession: "primary", lastTestedAt: iso(8) },
  { id: "proxy_2", url: "socks5://104.21.44.18:1080", status: "timeout", latencyMs: 12000, assignedSession: "secondary", lastTestedAt: iso(62) },
  { id: "proxy_3", url: "socks5://198.51.100.7:1080", status: "failed", lastTestedAt: iso(144) }
];

const mockResults: ProfileResult[] = [
  {
    id: "profile_1",
    jobId: "job_1027",
    profileUrl: "https://www.linkedin.com/in/sarthak-kashyapp/",
    full_name: "Sarthak Kashyapp",
    headline: "Software Engineer | Automation and Data Products",
    location: "Bengaluru, Karnataka, India",
    about: "Builds reliable data workflows and internal tools.",
    current_employment: { title: "Software Engineer", company: "HireZaap", duration: "2025 - Present", location: "Remote" },
    experience: [{ role: "Software Engineer", company: "HireZaap", duration: "2025 - Present", location: "Remote", description: "Scraping and automation systems." }],
    education: [{ school: "Indian Institute of Technology", degree: "B.Tech", field_of_study: "Computer Science" }],
    skills: ["Python", "Playwright", "Data Extraction"],
    email: "",
    status: "completed"
  },
  {
    id: "profile_2",
    jobId: "job_1027",
    profileUrl: "https://www.linkedin.com/in/sample-recruiter/",
    full_name: "Maya Iyer",
    headline: "Talent Partner for high-growth SaaS teams",
    location: "Mumbai, India",
    about: "",
    current_employment: { title: "Talent Partner", company: "Northstar Labs", duration: "2024 - Present", location: "Mumbai" },
    experience: [],
    education: [{ school: "NMIMS", degree: "MBA", field_of_study: "Human Resources" }],
    skills: ["Sourcing", "Recruiting", "Market Mapping"],
    email: "maya@example.com",
    status: "completed"
  },
  {
    id: "profile_3",
    jobId: "job_1027",
    profileUrl: "https://www.linkedin.com/in/blocked-profile/",
    full_name: "",
    headline: "",
    location: "",
    about: "",
    current_employment: { title: "", company: "", duration: "", location: "" },
    experience: [],
    education: [],
    skills: [],
    status: "failed",
    error: "LinkedIn blocked/redirected the session"
  }
];

function getBackendUrl() {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem("backendApiUrl");
    if (saved) return saved.replace(/\/$/, "");
  }
  return defaultSettings.backendApiUrl.replace(/\/$/, "");
}

async function request<T>(path: string, init?: RequestInit, fallback?: T): Promise<T> {
  try {
    const response = await fetch(`${getBackendUrl()}${path}`, {
      ...init,
      headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    if (fallback !== undefined) return structuredClone(fallback);
    throw error;
  }
}

export const api = {
  getDashboardMetrics: async (): Promise<DashboardMetrics> => {
    const completed = mockJobs.reduce((sum, job) => sum + job.completedProfiles, 0);
    const failed = mockJobs.reduce((sum, job) => sum + job.failedProfiles, 0);
    const total = mockJobs.reduce((sum, job) => sum + job.totalProfiles, 0);
    return request("/api/scraper/dashboard", undefined, {
      totalProfiles: total,
      completedProfiles: completed,
      failedProfiles: failed,
      pendingProfiles: total - completed - failed,
      activeSessions: mockSessions.filter((session) => session.loginStatus === "logged_in").length,
      proxyHealth: Math.round((mockProxies.filter((proxy) => proxy.status === "working").length / mockProxies.length) * 100)
    });
  },

  uploadCsv: async (file: File): Promise<UploadCsvResponse> => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/scraper/upload-csv", { method: "POST", body: form }, {
      uploadId: "upload_mock",
      filename: file.name,
      rows: [],
      validCount: 0,
      invalidCount: 0
    });
  },

  startScraping: (payload: StartScrapePayload) =>
    request<ScrapeJob>("/api/scraper/start", { method: "POST", body: JSON.stringify(payload) }, { ...mockJobs[0], status: "running" }),
  pauseScraping: (jobId: string) =>
    request<ScrapeJob>("/api/scraper/pause", { method: "POST", body: JSON.stringify({ jobId }) }, { ...mockJobs[0], id: jobId, status: "paused" }),
  retryScraping: (jobId: string) =>
    request<ScrapeJob>("/api/scraper/retry", { method: "POST", body: JSON.stringify({ jobId }) }, { ...mockJobs[0], id: jobId, status: "running" }),
  getJobs: () => request<ScrapeJob[]>("/api/scraper/jobs", undefined, mockJobs),
  getJob: (id: string) => request<ScrapeJob>(`/api/scraper/jobs/${id}`, undefined, mockJobs.find((job) => job.id === id) ?? mockJobs[0]),
  getLogs: (jobId: string) =>
    request<ScrapeLog[]>(`/api/scraper/logs/${jobId}`, undefined, [
      { id: "log_1", jobId, level: "info", message: "Loaded CSV and assigned profiles across sessions.", timestamp: iso(18) },
      { id: "log_2", jobId, level: "success", message: "primary saved data/sarthak-kashyapp.json", timestamp: iso(10) },
      { id: "log_3", jobId, level: "warning", message: "secondary proxy timed out; selecting replacement.", timestamp: iso(6) },
      { id: "log_4", jobId, level: "info", message: "Gemini extraction returned valid JSON.", timestamp: iso(2) }
    ]),
  getResults: (jobId: string) => request<ProfileResult[]>(`/api/scraper/results/${jobId}`, undefined, mockResults.filter((result) => result.jobId === jobId || jobId === "all")),

  createSession: (name: string) =>
    request<BrowserSession>("/api/sessions/create", { method: "POST", body: JSON.stringify({ name }) }, {
      id: `session_${name.toLowerCase()}`,
      name,
      userDataDir: `linkedin_sessions/${name.toLowerCase()}`,
      loginStatus: "not_configured",
      lastCheckedAt: new Date().toISOString()
    }),
  getSessions: () => request<BrowserSession[]>("/api/sessions", undefined, mockSessions),
  loginSession: (sessionId: string) =>
    request<BrowserSession>("/api/sessions/login", { method: "POST", body: JSON.stringify({ sessionId }) }, {
      ...(mockSessions.find((session) => session.id === sessionId) ?? mockSessions[0]),
      loginStatus: "logged_in",
      lastCheckedAt: new Date().toISOString()
    }),

  getProxies: () => request<ProxyItem[]>("/api/proxies", undefined, mockProxies),
  testProxy: (proxyUrl: string) =>
    request<ProxyItem>("/api/proxies/test", { method: "POST", body: JSON.stringify({ proxyUrl }) }, {
      id: `proxy_${Date.now()}`,
      url: proxyUrl,
      status: proxyUrl.includes("timeout") ? "timeout" : "working",
      latencyMs: 238,
      lastTestedAt: new Date().toISOString()
    }),
  assignProxy: (proxyId: string, sessionId: string) =>
    request<ProxyItem>("/api/proxies/assign", { method: "POST", body: JSON.stringify({ proxyId, sessionId }) }, {
      ...(mockProxies.find((proxy) => proxy.id === proxyId) ?? mockProxies[0]),
      assignedSession: sessionId
    }),

  getSettings: () => request<Settings>("/api/settings", undefined, defaultSettings),
  saveSettings: (settings: Settings) => {
    if (typeof window !== "undefined") window.localStorage.setItem("backendApiUrl", settings.backendApiUrl);
    return request<Settings>("/api/settings", { method: "POST", body: JSON.stringify(settings) }, settings);
  }
};
