import { NextResponse } from "next/server";
import { getProxies, getSessions, saveSessions } from "@/app/api/_lib/store";

export async function POST(request: Request) {
  const { proxyId, sessionId } = await request.json() as { proxyId: string; sessionId: string };
  const proxy = getProxies().find((item) => item.id === proxyId || item.url === proxyId);
  if (!proxy) return NextResponse.json({ error: "Proxy not found" }, { status: 404 });

  const sessions = getSessions();
  saveSessions(sessions.map((session) => session.id === sessionId || session.name === sessionId ? { ...session, proxyAssigned: proxy.url } : session));
  return NextResponse.json({ ...proxy, assignedSession: sessionId });
}
