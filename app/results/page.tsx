"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BriefcaseBusiness, Download, GraduationCap, Search, Sparkles, UserRound } from "lucide-react";
import type { ProfileResult } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  const saved = localStorage.getItem("latestScrapedProfiles");

  if (!saved) {
    setResults([]);
    return;
  }

  const parsed = JSON.parse(saved);

  const mapped = parsed.map((profile: any, index: number) => ({
    id: `profile_${index + 1}`,
    jobId: "latest",
    profileUrl: profile.profile_url || "",
    full_name: profile.full_name || "",
    headline: profile.headline || "",
    location: profile.location || "",
    about: profile.about || "",
    current_employment: profile.current_employment || {
      title: "",
      company: "",
      duration: "",
      location: "",
    },
    experience: profile.experience || [],
    education: profile.education || [],
    skills: profile.skills || [],
    email: profile.email || "",
    status: profile.full_name ? "completed" : "failed",
    sourceFile: profile.sourceFile || "",
    error: profile.error || "",
  }));

  setResults(mapped);
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
    const headers = ["full_name", "headline", "location", "about", "current_title", "current_company", "current_duration", "current_location", "experience", "education", "skills", "email", "status", "source_file"];
    const lines = filtered.map((profile) =>
      [
        profile.full_name,
        profile.headline,
        profile.location,
        profile.about,
        profile.current_employment.title,
        profile.current_employment.company,
        profile.current_employment.duration,
        profile.current_employment.location,
        profile.experience.map((item) => `${item.role} | ${item.company} | ${item.duration} | ${item.location} | ${item.description}`).join("; "),
        profile.education.map((item) => `${item.school} | ${item.degree} | ${item.field_of_study}`).join("; "),
        profile.skills.join("; "),
        profile.email ?? "",
        profile.status,
        profile.sourceFile ?? ""
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
                    <TableHead>Current Role</TableHead>
                    <TableHead>Experience</TableHead>
                    <TableHead>Education</TableHead>
                    <TableHead>Skills</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((profile) => (
                    <TableRow key={profile.id} className="transition-colors hover:bg-primary/5">
                      <TableCell className="min-w-44 font-medium">{profile.full_name || "Unknown"}</TableCell>
                      <TableCell className="min-w-72">{profile.headline || "-"}</TableCell>
                      <TableCell className="min-w-44">{profile.location || "-"}</TableCell>
                      <TableCell className="min-w-52">
                        {profile.current_employment.title ? (
                          <div>
                            <p className="font-medium">{profile.current_employment.title}</p>
                            <p className="text-xs text-muted-foreground">{profile.current_employment.company}</p>
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell>{profile.experience.length}</TableCell>
                      <TableCell>{profile.education.length}</TableCell>
                      <TableCell>{profile.skills.length}</TableCell>
                      <TableCell>{profile.email || "-"}</TableCell>
                      <TableCell><StatusBadge status={profile.status} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <ProfileDetailsDialog profile={profile} />
                        </div>
                      </TableCell>
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

function ProfileDetailsDialog({ profile }: { profile: ProfileResult }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">View</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto scrollbar-soft">
        <DialogHeader>
          <DialogTitle>{profile.full_name || "Unknown profile"}</DialogTitle>
          <DialogDescription>{profile.headline || "No headline extracted"}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm"><UserRound className="h-4 w-4 text-primary" />Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <FieldRow label="Full name" value={profile.full_name} />
                  <FieldRow label="Headline" value={profile.headline} />
                  <FieldRow label="Location" value={profile.location} />
                  <FieldRow label="Source file" value={profile.sourceFile ?? ""} />
                  <FieldRow label="Status" value={profile.status} />
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm"><BriefcaseBusiness className="h-4 w-4 text-primary" />Current Employment</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <FieldRow label="Title" value={profile.current_employment.title} />
                  <FieldRow label="Company" value={profile.current_employment.company} />
                  <FieldRow label="Duration" value={profile.current_employment.duration} />
                  <FieldRow label="Location" value={profile.current_employment.location} />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm">About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap rounded-lg border bg-secondary/30 p-4 text-sm leading-6">{profile.about || "No about section extracted."}</p>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><BriefcaseBusiness className="h-4 w-4 text-primary" />Experience</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.experience.length ? profile.experience.map((item, index) => (
                    <TableRow key={`${item.role}-${index}`} className="hover:bg-primary/5">
                      <TableCell className="min-w-44 font-medium">{item.role || "-"}</TableCell>
                      <TableCell className="min-w-40">{item.company || "-"}</TableCell>
                      <TableCell className="min-w-44">{item.duration || "-"}</TableCell>
                      <TableCell className="min-w-52">{item.location || "-"}</TableCell>
                      <TableCell className="min-w-96 whitespace-pre-wrap leading-6">{item.description || "-"}</TableCell>
                    </TableRow>
                  )) : <EmptyTableRow colSpan={5} label="No experience extracted" />}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><GraduationCap className="h-4 w-4 text-primary" />Education</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Degree</TableHead>
                    <TableHead>Field of study</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.education.length ? profile.education.map((item, index) => (
                    <TableRow key={`${item.school}-${index}`} className="hover:bg-primary/5">
                      <TableCell className="font-medium">{item.school || "-"}</TableCell>
                      <TableCell>{item.degree || "-"}</TableCell>
                      <TableCell>{item.field_of_study || "-"}</TableCell>
                    </TableRow>
                  )) : <EmptyTableRow colSpan={3} label="No education extracted" />}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-primary" />Skills</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {profile.skills.length ? profile.skills.map((skill) => <Badge key={skill} variant="secondary">{skill}</Badge>) : <span className="text-sm text-muted-foreground">No skills extracted.</span>}
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="w-36 text-xs font-semibold uppercase text-muted-foreground">{label}</TableCell>
      <TableCell>{value || "-"}</TableCell>
    </TableRow>
  );
}

function EmptyTableRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-muted-foreground">{label}</TableCell>
    </TableRow>
  );
}
