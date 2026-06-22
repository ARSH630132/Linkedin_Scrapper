"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LogIn, Plus, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { BrowserSession } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast-provider";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.getSessions().then(setSessions);
  }, []);

  async function createSession() {
    const session = await api.createSession(name || `profile-${sessions.length + 1}`);
    setSessions((current) => [...current, session]);
    setOpen(false);
    setName("");
    toast({ kind: "success", title: "Session created", description: `${session.name} is ready for login capture.` });
  }

  async function login(sessionId: string) {
    const session = await api.loginSession(sessionId);
    setSessions((current) => current.map((item) => (item.id === sessionId ? session : item)));
    toast({ kind: "success", title: "Login requested", description: "The backend can launch login_once for this session." });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <PageHeader
        title="Browser Sessions"
        description="Manage Playwright persistent profiles used for authenticated LinkedIn browsing and profile assignment."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" />Create Session</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create browser session</DialogTitle>
                <DialogDescription>Give the profile a stable name, then capture login with the backend helper.</DialogDescription>
              </DialogHeader>
              <Input placeholder="secondary" value={name} onChange={(event) => setName(event.target.value)} />
              <Button onClick={createSession}>Create</Button>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Session Profiles</CardTitle>
          <CardDescription>These map to user_data_dir folders such as linkedin_session and linkedin_sessions/secondary.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profile</TableHead>
                  <TableHead>Session Folder</TableHead>
                  <TableHead>Login Status</TableHead>
                  <TableHead>Proxy Assigned</TableHead>
                  <TableHead>Last Check</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">{session.name}</TableCell>
                    <TableCell>{session.userDataDir}</TableCell>
                    <TableCell><StatusBadge status={session.loginStatus} /></TableCell>
                    <TableCell>{session.proxyAssigned ?? "-"}</TableCell>
                    <TableCell>{new Date(session.lastCheckedAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => login(session.id)}><LogIn className="h-4 w-4" />Re-login</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
