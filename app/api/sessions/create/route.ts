import { mkdirSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { getSessions, rootDir, saveSessions } from "@/app/api/_lib/store";
import type { BrowserSession } from "@/types";

export async function POST(request: Request) {
  const { name } = await request.json() as { name: string };
  const safeName = (name || "session").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const userDataDir = safeName === "primary" ? "linkedin_session" : `linkedin_sessions/${safeName}`;
  mkdirSync(join(rootDir, userDataDir), { recursive: true });
  const session: BrowserSession = {
    id: `session_${safeName}`,
    name: safeName,
    userDataDir,
    loginStatus: "not_configured",
    lastCheckedAt: new Date().toISOString()
  };
  const sessions = getSessions().filter((item) => item.id !== session.id);
  saveSessions([...sessions, session]);
  return NextResponse.json(session);
}
