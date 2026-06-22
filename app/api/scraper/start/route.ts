import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { ensureDashboardDirs, getJobs, saveJobs, spawnScraper, uploadsDir } from "@/app/api/_lib/store";
import type { ScrapeJob, StartScrapePayload } from "@/types";

export async function POST(request: Request) {
  ensureDashboardDirs();
  const payload = await request.json() as StartScrapePayload;
  const id = `job_${Date.now()}`;
  let csvPath = payload.uploadId
    ? join(uploadsDir, `${payload.uploadId}.csv`)
    : join(uploadsDir, `${id}.csv`);

  if ((!payload.uploadId || !existsSync(csvPath)) && payload.profileUrls?.length) {
    csvPath = join(uploadsDir, `${id}.csv`);
    writeFileSync(csvPath, `profile_url\n${payload.profileUrls.join("\n")}\n`, "utf-8");
  }

  const totalProfiles = payload.profileUrls?.length ?? 0;
  const job: ScrapeJob = {
    id,
    name: `LinkedIn scrape ${new Date().toLocaleString()}`,
    status: "running",
    csvPath,
    progress: 0,
    totalProfiles,
    completedProfiles: 0,
    failedProfiles: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveJobs([job, ...getJobs()]);
  spawnScraper(job, csvPath);
  return NextResponse.json(job);
}
