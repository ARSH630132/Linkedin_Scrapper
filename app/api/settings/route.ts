import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/app/api/_lib/store";
import type { Settings } from "@/types";

export async function GET() {
  return NextResponse.json(getSettings());
}

export async function POST(request: Request) {
  const settings = await request.json() as Settings;
  return NextResponse.json(saveSettings(settings));
}
