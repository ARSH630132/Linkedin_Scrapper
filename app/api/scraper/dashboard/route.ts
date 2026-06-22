import { NextResponse } from "next/server";
import { getProxies, getSessions, profilesCsvStats } from "@/app/api/_lib/store";

export async function GET() {
  const stats = profilesCsvStats();
  const proxies = getProxies();
  const working = proxies.filter((proxy) => proxy.status === "working").length;
  return NextResponse.json({
    totalProfiles: stats.total,
    completedProfiles: stats.completed,
    failedProfiles: stats.failed,
    pendingProfiles: Math.max(0, stats.total - stats.completed - stats.failed),
    activeSessions: getSessions().filter((session) => session.loginStatus === "logged_in").length,
    proxyHealth: proxies.length ? Math.round((working / proxies.length) * 100) : 0
  });
}
