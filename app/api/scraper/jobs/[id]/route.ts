import { NextResponse } from "next/server";
import { getJobs } from "@/app/api/_lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJobs().find((item) => item.id === id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Job not found" }, { status: 404 });
}
