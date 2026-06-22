import { NextResponse } from "next/server";
import { appendLog, getJobs, saveJobs } from "@/app/api/_lib/store";

export async function POST(request: Request) {
  const { jobId } = await request.json() as { jobId: string };
  let updated = getJobs()[0];
  const jobs = getJobs().map((job) => {
    if (job.id !== jobId) return job;
    if (job.processId) {
      try {
        process.kill(job.processId);
      } catch {
        appendLog(jobId, "warning", `Could not stop process ${job.processId}. It may have already exited.`);
      }
    }
    updated = { ...job, status: "paused", updatedAt: new Date().toISOString() };
    return updated;
  });
  saveJobs(jobs);
  appendLog(jobId, "warning", "Pause requested from dashboard.");
  return NextResponse.json(updated);
}
