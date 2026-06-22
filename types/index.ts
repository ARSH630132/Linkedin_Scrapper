export type JobStatus = "pending" | "running" | "paused" | "completed" | "failed";
export type ProfileStatus = "pending" | "completed" | "failed";
export type ProxyStatus = "untested" | "working" | "failed" | "timeout";

export interface DashboardMetrics {
  totalProfiles: number;
  completedProfiles: number;
  failedProfiles: number;
  pendingProfiles: number;
  activeSessions: number;
  proxyHealth: number;
}

export interface CsvPreviewRow {
  profile_url: string;
  rowNumber: number;
  valid: boolean;
  reason?: string;
}

export interface UploadCsvResponse {
  uploadId: string;
  filename: string;
  rows: CsvPreviewRow[];
  validCount: number;
  invalidCount: number;
}

export interface ScrapeJob {
  id: string;
  name: string;
  status: JobStatus;
  processId?: number;
  csvPath?: string;
  progress: number;
  totalProfiles: number;
  completedProfiles: number;
  failedProfiles: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScrapeLog {
  id: string;
  jobId: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  timestamp: string;
}

export interface CurrentEmployment {
  title: string;
  company: string;
  duration: string;
  location: string;
}

export interface ExperienceItem {
  role: string;
  company: string;
  duration: string;
  location: string;
  description: string;
}

export interface EducationItem {
  school: string;
  degree: string;
  field_of_study: string;
}

export interface ProfileResult {
  id: string;
  jobId: string;
  sourceFile?: string;
  profileUrl: string;
  full_name: string;
  headline: string;
  location: string;
  about: string;
  current_employment: CurrentEmployment;
  experience: ExperienceItem[];
  education: EducationItem[];
  skills: string[];
  email?: string;
  status: ProfileStatus;
  error?: string;
}

export interface BrowserSession {
  id: string;
  name: "primary" | "secondary" | "tertiary" | string;
  userDataDir: string;
  loginStatus: "logged_in" | "expired" | "not_configured";
  proxyAssigned?: string;
  lastCheckedAt: string;
}

export interface ProxyItem {
  id: string;
  url: string;
  status: ProxyStatus;
  latencyMs?: number;
  assignedSession?: string;
  lastTestedAt?: string;
}

export interface Settings {
  backendApiUrl: string;
  apiProvider: "gemini" | "openrouter";
  apiKey: string;
  maxParallelWorkers: number;
  headless: boolean;
  retryCount: number;
  delayMinSeconds: number;
  delayMaxSeconds: number;
}

export interface StartScrapePayload {
  uploadId?: string;
  profileUrls?: string[];
  sessionIds?: string[];
}
