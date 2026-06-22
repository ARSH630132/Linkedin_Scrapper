import { NextResponse } from "next/server";
import { fileModifiedIso, getJobs, profilesCsvStats } from "@/app/api/_lib/store";
import type { ScrapeJob } from "@/types";

export async function GET() {
  const jobs = getJobs();
  if (jobs.length) return NextResponse.json(jobs);
  const stats = profilesCsvStats();
  const fallback: ScrapeJob = {
    id: "profiles_csv",
    name: "profiles.csv",
    status: stats.completed === stats.total && stats.total > 0 ? "completed" : "pending",
    progress: stats.total ? Math.round((stats.completed / stats.total) * 100) : 0,
    totalProfiles: stats.total,
    completedProfiles: stats.completed,
    failedProfiles: stats.failed,
    createdAt: fileModifiedIso("profiles.csv"),
    updatedAt: fileModifiedIso("profiles.csv")
  };
  return NextResponse.json([fallback]);
}
