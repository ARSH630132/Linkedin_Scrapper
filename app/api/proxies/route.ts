import { NextResponse } from "next/server";
import { getProxies } from "@/app/api/_lib/store";

export async function GET() {
  return NextResponse.json(getProxies());
}
