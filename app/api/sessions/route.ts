import { NextResponse } from "next/server";
import { getSessions } from "@/app/api/_lib/store";

export async function GET() {
  return NextResponse.json(getSessions());
}
