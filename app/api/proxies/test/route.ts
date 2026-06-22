import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { addProxy } from "@/app/api/_lib/store";
import type { ProxyItem } from "@/types";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  const { proxyUrl } = await request.json() as { proxyUrl: string };
  const started = Date.now();
  let status: ProxyItem["status"] = "failed";
  try {
    await execFileAsync("python", [
      "-c",
      "import sys,requests; p=sys.argv[1]; r=requests.get('http://api.iplocate.io/ip', proxies={'http':p,'https':p}, timeout=12); sys.exit(0 if r.status_code==200 and r.text.strip() else 1)",
      proxyUrl
    ], { timeout: 13_000 });
    status = "working";
  } catch (error) {
    status = error instanceof Error && error.message.toLowerCase().includes("timed out") ? "timeout" : "failed";
  }
  const proxy: ProxyItem = {
    id: `proxy_${Date.now()}`,
    url: proxyUrl,
    status,
    latencyMs: Date.now() - started,
    lastTestedAt: new Date().toISOString()
  };
  addProxy(proxy);
  return NextResponse.json(proxy);
}
