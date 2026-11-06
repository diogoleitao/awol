"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// A Scan or Discovery in the top bar: its run button, `children`, which
// spins while it runs, and a tab to its page, at `href`. Red marks it when
// `warning`; hovering or focusing it shows `details`, its last run.
export function RunItem({
  label,
  href,
  warning,
  details,
  children,
}: {
  label: string;
  href: string;
  warning: boolean;
  details: string[];
  children: ReactNode;
}) {
  const current = usePathname() === href;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-0.5 rounded-md border pl-0.5", warning && "border-destructive/50 text-destructive")}>
          {children}
          <span aria-hidden className={cn("h-4 w-px bg-border", warning && "bg-destructive/30")} />
          <Link
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2 rounded-r-md px-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
              current && "bg-accent",
            )}
          >
            {label}
            {warning && <TriangleAlert className="size-4" />}
          </Link>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {details.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
