"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, CheckCircle2, Clock3, Globe2, Layers3, UsersRound } from "lucide-react";
import { api } from "@/lib/api";
import type { DashboardMetrics, ScrapeJob } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";

const chartData = [
  { day: "Mon", completed: 22, failed: 1 },
  { day: "Tue", completed: 36, failed: 3 },
  { day: "Wed", completed: 48, failed: 2 },
  { day: "Thu", completed: 64, failed: 4 },
  { day: "Fri", completed: 81, failed: 5 },
  { day: "Sat", completed: 102, failed: 4 }
];

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);

  useEffect(() => {
    Promise.all([api.getDashboardMetrics(), api.getJobs()]).then(([nextMetrics, nextJobs]) => {
      setMetrics(nextMetrics);
      setJobs(nextJobs);
    });
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <PageHeader title="Scraper Operations" description="Monitor profile extraction throughput, session health, proxy readiness, and recent scraping jobs from one command center." />

      {!metrics ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-36" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Total profiles" value={metrics.totalProfiles} icon={UsersRound} detail="Across active and historical jobs" />
          <MetricCard label="Completed" value={metrics.completedProfiles} icon={CheckCircle2} detail="Valid JSON extraction completed" />
          <MetricCard label="Failed" value={metrics.failedProfiles} icon={AlertCircle} detail="Blocked, invalid, or extraction errors" />
          <MetricCard label="Pending" value={metrics.pendingProfiles} icon={Clock3} detail="Queued for browser workers" />
          <MetricCard label="Active sessions" value={metrics.activeSessions} icon={Layers3} detail="Logged-in Playwright profiles" />
          <MetricCard label="Proxy health" value={`${metrics.proxyHealth}%`} icon={Globe2} detail="Working proxies in current pool" />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Extraction Throughput</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="completed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="completed" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#completed)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Scraping Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium">{job.name}</TableCell>
                      <TableCell><StatusBadge status={job.status} /></TableCell>
                      <TableCell className="min-w-32"><Progress value={job.progress} /></TableCell>
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
