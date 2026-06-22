import { NextResponse } from "next/server";
import { appendLog, getJobs, saveJobs, spawnScraper } from "@/app/api/_lib/store";

export async function POST(request: Request) {
  const { jobId } = await request.json() as { jobId: string };
  let updated = getJobs()[0];
  const jobs = getJobs().map((job) => {
    if (job.id !== jobId) return job;
    updated = { ...job, status: "running", progress: 0, updatedAt: new Date().toISOString() };
    return updated;
  });
  saveJobs(jobs);
  if (updated.csvPath) {
    spawnScraper(updated, updated.csvPath);
  } else {
    appendLog(jobId, "warning", "Retry requested, but no CSV path was stored for this job.");
  }
  return NextResponse.json(updated);
}
