"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play, RefreshCcw, TerminalSquare } from "lucide-react";
import { api } from "@/lib/api";
import type { ScrapeJob, ScrapeLog } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast-provider";
import { cn } from "@/lib/utils";

export default function JobsPage() {
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    api.getJobs().then((nextJobs) => {
      setJobs(nextJobs);
      setSelectedJobId(nextJobs[0]?.id ?? "");
    });
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    api.getLogs(selectedJobId).then(setLogs);
    const timer = window.setInterval(() => api.getLogs(selectedJobId).then(setLogs), 5000);
    return () => window.clearInterval(timer);
  }, [selectedJobId]);

  async function mutateJob(action: "pause" | "retry" | "start", job: ScrapeJob) {
    const nextJob =
      action === "pause" ? await api.pauseScraping(job.id) : action === "retry" ? await api.retryScraping(job.id) : await api.startScraping({ uploadId: job.id });
    setJobs((current) => current.map((item) => (item.id === job.id ? nextJob : item)));
    toast({ kind: "success", title: `Job ${action} requested`, description: `${job.name} has been updated.` });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <PageHeader title="Scraping Jobs" description="Track batch status, control running jobs, and inspect near real-time worker logs from the scraper backend." />

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <CardTitle>Job Queue</CardTitle>
            <CardDescription>Start, pause, or retry jobs without leaving the dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Profiles</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id} className={cn(selectedJobId === job.id && "bg-muted/60")} onClick={() => setSelectedJobId(job.id)}>
                      <TableCell>
                        <p className="font-medium">{job.name}</p>
                        <p className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</p>
                      </TableCell>
                      <TableCell><StatusBadge status={job.status} /></TableCell>
                      <TableCell>{job.completedProfiles}/{job.totalProfiles}</TableCell>
                      <TableCell className="min-w-44">
                        <div className="flex items-center gap-3">
                          <Progress value={job.progress} />
                          <span className="w-10 text-xs text-muted-foreground">{job.progress}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); mutateJob("start", job); }}>
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); mutateJob("pause", job); }}>
                            <Pause className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={(event) => { event.stopPropagation(); mutateJob("retry", job); }}>
                            <RefreshCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TerminalSquare className="h-4 w-4" />Live Logs</CardTitle>
            <CardDescription>Polling GET /api/scraper/logs/:jobId.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[470px] overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs text-zinc-100 scrollbar-soft">
              {logs.length === 0 ? (
                <p className="text-zinc-400">No logs yet.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="mb-3">
                    <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()} </span>
                    <span className={cn(log.level === "error" && "text-red-300", log.level === "success" && "text-emerald-300", log.level === "warning" && "text-amber-300")}>
                      [{log.level}]
                    </span>{" "}
                    <span>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
