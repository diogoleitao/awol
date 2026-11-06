"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// A card of the Discovery page's sidebar: a header with `icon`, `title` and,
// under it while open, `description`, that opens and closes `children`. It starts open
// when `defaultOpen`, and live updates keep it as it is.
export function CollapsibleCard({
  icon,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group rounded-lg border bg-card">
      <CollapsibleTrigger className="flex w-full items-start gap-2 rounded-lg px-4 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium">{title}</span>
          <span className="hidden text-xs text-muted-foreground group-data-[state=open]:block">{description}</span>
        </span>
        <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
