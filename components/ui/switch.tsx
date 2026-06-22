"use client";

import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: SwitchPrimitives.SwitchProps) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitives.Root>
  );
}
