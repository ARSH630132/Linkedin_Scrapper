"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
type Toast = { id: string; title: string; description?: string; kind: ToastKind };

const ToastContext = createContext<{ toast: (toast: Omit<Toast, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((payload: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...payload, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3">
        <AnimatePresence>
          {toasts.map((item) => {
            const Icon = item.kind === "success" ? CheckCircle2 : item.kind === "error" ? XCircle : Info;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.98 }}
                className={cn(
                  "rounded-lg border bg-card p-4 shadow-soft",
                  item.kind === "success" && "border-emerald-500/30",
                  item.kind === "error" && "border-destructive/30"
                )}
              >
                <div className="flex gap-3">
                  <Icon className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{item.title}</p>
                    {item.description ? <p className="mt-1 text-sm text-muted-foreground">{item.description}</p> : null}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
