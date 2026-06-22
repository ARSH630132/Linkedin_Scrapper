"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import { motion } from "framer-motion";
import { FileCheck2, FileUp, Play, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { CsvPreviewRow } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast-provider";

const linkedinPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[^/\s?]+/i;

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CsvPreviewRow[]>([]);
  const [uploadId, setUploadId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const { toast } = useToast();

  const validCount = useMemo(() => rows.filter((row) => row.valid).length, [rows]);
  const invalidRows = useMemo(() => rows.filter((row) => !row.valid), [rows]);
  const hasProfileColumn = rows.length > 0 || !file ? true : false;

  function parseCsv(nextFile: File) {
    setFile(nextFile);
    setUploadId(undefined);
    Papa.parse<Record<string, string>>(nextFile, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const fields = result.meta.fields?.map((field) => field.trim().toLowerCase()) ?? [];
        if (!fields.includes("profile_url")) {
          setRows([]);
          toast({ kind: "error", title: "Missing profile_url column", description: "Add a profile_url column before starting a scraping job." });
          return;
        }
        const preview = result.data.map((row, index) => {
          const profileUrl = (row.profile_url ?? "").trim();
          const valid = linkedinPattern.test(profileUrl);
          return {
            profile_url: profileUrl,
            rowNumber: index + 2,
            valid,
            reason: valid ? undefined : "Invalid LinkedIn profile URL"
          };
        });
        setRows(preview);
        toast({ kind: "success", title: "CSV parsed", description: `${preview.length} rows loaded for validation.` });
      },
      error: (error) => toast({ kind: "error", title: "Could not parse CSV", description: error.message })
    });
  }

  async function startScraping() {
  if (!file || validCount === 0) return;

  setLoading(true);
  setProfiles([]);

  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/scrape/csv`, {
      method: "POST",
      body: formData,
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.detail || "Backend request failed.");
    }

    setProfiles(result.data?.profiles || []);

    toast({
      kind: "success",
      title: "Scraping completed",
      description: `${result.data?.total_profiles || 0} profiles extracted.`,
    });
  } catch (error) {
    toast({
      kind: "error",
      title: "Scraping failed",
      description: error instanceof Error ? error.message : "Backend request failed.",
    });
  } finally {
    setLoading(false);
  }
}

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <PageHeader title="CSV Upload" description="Upload a CSV with LinkedIn profile URLs, validate the profile_url column, inspect invalid rows, then start a scraping job." />

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Upload Source File</CardTitle>
            <CardDescription>Drop a CSV file exported from your sourcing workflow.</CardDescription>
          </CardHeader>
          <CardContent>
            <label
              className="flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-secondary/40 p-8 text-center transition-colors hover:bg-secondary"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped = event.dataTransfer.files[0];
                if (dropped) parseCsv(dropped);
              }}
            >
              <FileUp className="h-10 w-10 text-primary" />
              <span className="mt-4 text-sm font-semibold">{file ? file.name : "Drag CSV here or browse"}</span>
              <span className="mt-2 text-sm text-muted-foreground">Required column: profile_url</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => event.target.files?.[0] && parseCsv(event.target.files[0])} />
            </label>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Valid URLs</p>
                <p className="mt-1 text-2xl font-semibold">{validCount}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Invalid URLs</p>
                <p className="mt-1 text-2xl font-semibold">{invalidRows.length}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">Rows</p>
                <p className="mt-1 text-2xl font-semibold">{rows.length}</p>
              </div>
            </div>

            <Button className="mt-5 w-full" disabled={!hasProfileColumn || validCount === 0 || loading} onClick={startScraping}>
              <Play className="h-4 w-4" />
              {loading ? "Scraping..." : "Start Scraping"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CSV Preview</CardTitle>
            <CardDescription>Showing the first 50 parsed rows with validation state.</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border bg-secondary/30 text-center">
                <FileCheck2 className="h-10 w-10 text-muted-foreground" />
                <p className="mt-4 text-sm font-semibold">No CSV loaded</p>
                <p className="mt-1 text-sm text-muted-foreground">Your preview table will appear here.</p>
              </div>
            ) : (
              <div className="max-h-[520px] overflow-auto rounded-lg border scrollbar-soft">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>profile_url</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 50).map((row) => (
                      <TableRow key={`${row.rowNumber}-${row.profile_url}`}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell className="max-w-96 truncate">{row.profile_url}</TableCell>
                        <TableCell>
                          {row.valid ? <Badge variant="success">valid</Badge> : <Badge variant="destructive"><TriangleAlert className="mr-1 h-3 w-3" />invalid</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {profiles.length > 0 && (
  <Card className="mt-6">
    <CardHeader>
      <CardTitle>Scraped Profiles</CardTitle>
      <CardDescription>Complete extracted LinkedIn profile data.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {profiles.map((profile, index) => (
        <div key={index} className="rounded-xl border p-5">
          <h2 className="text-2xl font-bold">{profile.full_name || "Unknown"}</h2>
          <p className="mt-1 text-muted-foreground">{profile.headline || "-"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{profile.location || "-"}</p>

          <div className="mt-4">
            <h3 className="font-semibold">About</h3>
            <p className="mt-1 whitespace-pre-line text-sm">{profile.about || "-"}</p>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold">Current Employment</h3>
            <p className="text-sm">
              {profile.current_employment?.title || "-"} at {profile.current_employment?.company || "-"}
            </p>
            <p className="text-sm text-muted-foreground">{profile.current_employment?.duration || "-"}</p>
            <p className="text-sm text-muted-foreground">{profile.current_employment?.location || "-"}</p>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold">Experience</h3>
            <div className="mt-2 space-y-3">
              {profile.experience?.length ? (
                profile.experience.map((exp: any, i: number) => (
                  <div key={i} className="border-l pl-4">
                    <p className="font-medium">{exp.role || "-"}</p>
                    <p className="text-sm">{exp.company || "-"}</p>
                    <p className="text-sm text-muted-foreground">{exp.duration || "-"}</p>
                    <p className="text-sm text-muted-foreground">{exp.location || "-"}</p>
                    <p className="mt-1 whitespace-pre-line text-sm">{exp.description || "-"}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">-</p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold">Education</h3>
            <div className="mt-2 space-y-2">
              {profile.education?.length ? (
                profile.education.map((edu: any, i: number) => (
                  <div key={i}>
                    <p className="font-medium">{edu.school || "-"}</p>
                    <p className="text-sm">{edu.degree || "-"}</p>
                    <p className="text-sm text-muted-foreground">{edu.field_of_study || "-"}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">-</p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold">Skills</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {profile.skills?.length ? (
                profile.skills.map((skill: string, i: number) => (
                  <Badge key={i} variant="secondary">{skill}</Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">-</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
)}
    </motion.div>
  );
}
