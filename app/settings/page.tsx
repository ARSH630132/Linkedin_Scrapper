"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import type { Settings } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/toast-provider";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  async function save() {
    if (!settings) return;
    const saved = await api.saveSettings(settings);
    setSettings(saved);
    toast({ kind: "success", title: "Settings saved", description: "Backend API preferences and worker limits have been updated." });
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <PageHeader title="Settings" description="Configure backend connectivity, worker behavior, retry limits, and human-like delay ranges." />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Scraper Configuration</CardTitle>
          <CardDescription>Saved locally for the dashboard and posted to GET/POST /api/settings when available.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {settings ? (
            <>
              <div>
                <label className="text-sm font-medium">Backend API URL</label>
                <Input className="mt-2" value={settings.backendApiUrl} onChange={(event) => update("backendApiUrl", event.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Max parallel workers</label>
                  <Input className="mt-2" type="number" min={1} value={settings.maxParallelWorkers} onChange={(event) => update("maxParallelWorkers", Number(event.target.value))} />
                </div>
                <div>
                  <label className="text-sm font-medium">Retry count</label>
                  <Input className="mt-2" type="number" min={0} value={settings.retryCount} onChange={(event) => update("retryCount", Number(event.target.value))} />
                </div>
                <div>
                  <label className="text-sm font-medium">Delay min seconds</label>
                  <Input className="mt-2" type="number" min={0} value={settings.delayMinSeconds} onChange={(event) => update("delayMinSeconds", Number(event.target.value))} />
                </div>
                <div>
                  <label className="text-sm font-medium">Delay max seconds</label>
                  <Input className="mt-2" type="number" min={0} value={settings.delayMaxSeconds} onChange={(event) => update("delayMaxSeconds", Number(event.target.value))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Headless browser mode</p>
                  <p className="text-sm text-muted-foreground">Run Chromium workers without visible browser windows.</p>
                </div>
                <Switch checked={settings.headless} onCheckedChange={(checked) => update("headless", checked)} />
              </div>
              <Button onClick={save}><Save className="h-4 w-4" />Save settings</Button>
            </>
          ) : (
            <div className="h-72 animate-pulse rounded-lg bg-muted" />
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
