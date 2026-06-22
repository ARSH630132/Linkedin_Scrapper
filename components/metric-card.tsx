import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function MetricCard({ label, value, icon: Icon, detail }: { label: string; value: string | number; icon: LucideIcon; detail: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-normal">{value}</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
