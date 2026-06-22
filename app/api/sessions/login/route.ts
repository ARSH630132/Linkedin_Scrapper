import { spawn } from "child_process";
import { NextResponse } from "next/server";
import { getSessions, rootDir, saveSessions } from "@/app/api/_lib/store";

export async function POST(request: Request) {
  const { sessionId } = await request.json() as { sessionId: string };
  const sessions = getSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  spawn("python", ["-m", "linkedin_tool.login_once", "--user-data-dir", session.userDataDir], {
    cwd: rootDir,
    detached: true,
    shell: process.platform === "win32",
    stdio: "ignore"
  }).unref();

  const updated = { ...session, loginStatus: "logged_in" as const, lastCheckedAt: new Date().toISOString() };
  saveSessions(sessions.map((item) => item.id === sessionId ? updated : item));
  return NextResponse.json(updated);
}
