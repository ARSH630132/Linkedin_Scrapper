import { Badge } from "@/components/ui/badge";
import type { JobStatus, ProfileStatus, ProxyStatus } from "@/types";

export function StatusBadge({ status }: { status: JobStatus | ProfileStatus | ProxyStatus | string }) {
  const variant =
    status === "completed" || status === "working" || status === "logged_in"
      ? "success"
      : status === "failed" || status === "timeout" || status === "expired"
        ? "destructive"
        : status === "running" || status === "pending"
          ? "warning"
          : "secondary";

  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
