"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// A Scan or Discovery in the top bar: its run button, `children`, which
// spins while it runs, and its label, a tab to its page when it has one, at
// `href`, or plain text. Red marks it when `warning`; hovering or focusing
// its run button shows `details`, its last run, and hovering or focusing
// its label shows `description`, what it does.
export function RunItem({
  label,
  description,
  href,
  warning,
  details,
  children,
}: {
  label: string;
  description: string;
  href?: string;
  warning: boolean;
  details: string[];
  children: ReactNode;
}) {
  const current = usePathname() === href;
  const text = (
    <>
      {label}
      {warning && <TriangleAlert className="size-4" />}
    </>
  );
  return (
    <div className={cn("flex items-center gap-0.5 rounded-md border pl-0.5", warning && "border-destructive/50 text-destructive")}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Hovered even while the button is disabled, which lets the
              pointer through to it. */}
          <span className="flex">{children}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {details.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </TooltipContent>
      </Tooltip>
      <span aria-hidden className={cn("h-4 w-px bg-border", warning && "bg-destructive/30")} />
      <Tooltip>
        <TooltipTrigger asChild>
          {href === undefined ? (
            <span className="flex h-8 items-center gap-2 px-3 text-sm font-medium">{text}</span>
          ) : (
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2 rounded-r-md px-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current && "bg-accent",
              )}
            >
              {text}
            </Link>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">{description}</TooltipContent>
      </Tooltip>
    </div>
  );
}
