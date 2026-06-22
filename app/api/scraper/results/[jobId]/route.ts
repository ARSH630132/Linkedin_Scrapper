import { NextResponse } from "next/server";
import { getResults } from "@/app/api/_lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return NextResponse.json(getResults(jobId));
}
