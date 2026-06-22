"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { ProfileResult } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast-provider";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ResultsPage() {
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [query, setQuery] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    api.getResults("all").then(setResults);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return results.filter((profile) =>
      [profile.full_name, profile.headline, profile.location, profile.email, profile.status].join(" ").toLowerCase().includes(needle)
    );
  }, [query, results]);

  function exportJson() {
    download("linkedin-results.json", JSON.stringify(filtered, null, 2), "application/json");
    toast({ kind: "success", title: "JSON export ready", description: `${filtered.length} profiles exported.` });
  }

  function exportCsv() {
    const headers = ["name", "headline", "location", "experience", "education", "email", "status"];
    const lines = filtered.map((profile) =>
      [
        profile.full_name,
        profile.headline,
        profile.location,
        profile.experience.map((item) => `${item.role} at ${item.company}`).join("; "),
        profile.education.map((item) => item.school).join("; "),
        profile.email ?? "",
        profile.status
      ].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
    );
    download("linkedin-results.csv", [headers.join(","), ...lines].join("\n"), "text/csv");
    toast({ kind: "success", title: "CSV export ready", description: `${filtered.length} profiles exported.` });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <PageHeader
        title="Profile Results"
        description="Search extracted LinkedIn profiles, review structured JSON fields, and export clean data for your recruiting workflow."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" />CSV</Button>
            <Button onClick={exportJson}><Download className="h-4 w-4" />JSON</Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Extracted Profiles</CardTitle>
          <CardDescription>Mapped to the Python scraper schema plus optional email when available.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name, headline, location, status" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>

          {filtered.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border bg-secondary/30 text-center">
              <Search className="h-10 w-10 text-muted-foreground" />
              <p className="mt-4 text-sm font-semibold">No profiles found</p>
              <p className="mt-1 text-sm text-muted-foreground">Adjust filters or run a scraping job first.</p>
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border scrollbar-soft">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Headline</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Experience</TableHead>
                    <TableHead>Education</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell className="min-w-44 font-medium">{profile.full_name || "Unknown"}</TableCell>
                      <TableCell className="min-w-72">{profile.headline || "-"}</TableCell>
                      <TableCell className="min-w-44">{profile.location || "-"}</TableCell>
                      <TableCell>{profile.experience.length}</TableCell>
                      <TableCell>{profile.education.length}</TableCell>
                      <TableCell>{profile.email || "-"}</TableCell>
                      <TableCell><StatusBadge status={profile.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
