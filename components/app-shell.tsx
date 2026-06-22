"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import {
  BarChart3,
  BriefcaseBusiness,
  Database,
  FileUp,
  Globe2,
  Menu,
  Moon,
  PlayCircle,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  X
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";

const navItems: { href: Route; label: string; icon: typeof BarChart3 }[] = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/upload", label: "CSV Upload", icon: FileUp },
  { href: "/jobs", label: "Scraping Jobs", icon: PlayCircle },
  { href: "/results", label: "Results", icon: Database },
  { href: "/sessions", label: "Sessions", icon: ShieldCheck },
  { href: "/proxies", label: "Proxies", icon: Globe2 },
  { href: "/settings", label: "Settings", icon: Settings }
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-3 border-b px-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BriefcaseBusiness className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">HireZaap</p>
          <p className="mt-1 text-xs text-muted-foreground">LinkedIn Scraper</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "bg-primary/10 text-primary"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <div className="rounded-lg bg-secondary p-3">
          <p className="text-xs font-semibold">Backend Mode</p>
          <p className="mt-1 text-xs text-muted-foreground">Auto-connect with mock fallback enabled.</p>
        </div>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-y-0 left-0 z-40 hidden w-72 lg:block">
        <Sidebar />
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/45" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
          <Button variant="secondary" size="icon" className="absolute right-4 top-4" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-xl md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="relative hidden flex-1 md:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="max-w-md pl-9" placeholder="Search jobs, profiles, sessions" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="hidden items-center gap-3 rounded-md border bg-card px-3 py-2 sm:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary">
                <UserRound className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold">Recruiting Ops</p>
                <p className="text-xs text-muted-foreground">Data Team</p>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
