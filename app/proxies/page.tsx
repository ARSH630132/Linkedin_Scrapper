"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FileUp, Plus, Zap } from "lucide-react";
import { api } from "@/lib/api";
import type { BrowserSession, ProxyItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast-provider";

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [proxyUrl, setProxyUrl] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([api.getProxies(), api.getSessions()]).then(([nextProxies, nextSessions]) => {
      setProxies(nextProxies);
      setSessions(nextSessions);
    });
  }, []);

  async function addAndTest(url = proxyUrl) {
    if (!url.trim()) return;
    const proxy = await api.testProxy(url.trim());
    setProxies((current) => [proxy, ...current]);
    setProxyUrl("");
    toast({ kind: proxy.status === "working" ? "success" : "error", title: "Proxy tested", description: `${proxy.url} is ${proxy.status}.` });
  }

  async function uploadProxyFile(file: File) {
    const text = await file.text();
    const urls = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const tested = await Promise.all(urls.slice(0, 25).map((url) => api.testProxy(url)));
    setProxies((current) => [...tested, ...current]);
    toast({ kind: "success", title: "Proxy file processed", description: `${tested.length} proxies tested from ${file.name}.` });
  }

  async function assign(proxy: ProxyItem, sessionId: string) {
    const nextProxy = await api.assignProxy(proxy.id, sessionId);
    setProxies((current) => current.map((item) => (item.id === proxy.id ? nextProxy : item)));
    toast({ kind: "success", title: "Proxy assigned", description: `${proxy.url} assigned to ${sessionId}.` });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <PageHeader title="Proxy Manager" description="Add SOCKS proxies, upload proxy pools, test health, and assign working routes to browser sessions." />

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Add Proxies</CardTitle>
            <CardDescription>Use socks5://user:pass@host:port or socks5://host:port.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input placeholder="socks5://host:port" value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} />
              <Button onClick={() => addAndTest()}><Plus className="h-4 w-4" /></Button>
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-secondary/40 p-6 text-sm font-medium hover:bg-secondary">
              <FileUp className="h-4 w-4" />
              Upload proxies.txt
              <input type="file" accept=".txt,text/plain" className="sr-only" onChange={(event) => event.target.files?.[0] && uploadProxyFile(event.target.files[0])} />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Proxy Pool</CardTitle>
            <CardDescription>Working proxies can be assigned to primary, secondary, or tertiary sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-lg border scrollbar-soft">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proxy</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead className="text-right">Assign</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proxies.map((proxy) => (
                    <TableRow key={proxy.id}>
                      <TableCell className="min-w-72 font-mono text-xs">{proxy.url}</TableCell>
                      <TableCell><StatusBadge status={proxy.status} /></TableCell>
                      <TableCell>{proxy.latencyMs ? `${proxy.latencyMs}ms` : "-"}</TableCell>
                      <TableCell>{proxy.assignedSession ?? "-"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {sessions.slice(0, 3).map((session) => (
                            <Button key={session.id} variant="outline" size="sm" onClick={() => assign(proxy, session.name)}>
                              <Zap className="h-3 w-3" />{session.name}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
