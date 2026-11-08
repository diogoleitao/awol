"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// A section of a sidebar, as the hidden sidebar shows it: its icon, named on
// hover.
export type SidebarSection = { name: string; icon: ReactNode };

// A page with `sidebar` on its left, above it on narrow screens, and
// `children` beside it, one under the other. A button at its bottom hides
// the sidebar, leaving the icon of each of its `sections`, named on hover,
// and the button, any of which shows it again; hiding it keeps what is open
// or ticked in it. It starts shown, and live updates keep it as it is.
//
// On wide screens the page fills the window under the top bar and never
// scrolls as a whole: the sidebar stays in place, scrolling what it holds
// above its button, and `children` scroll beside it only when they run past
// the window, which a child that scrolls on its own, as a table can, keeps
// them from doing.
export function SidebarLayout({ sidebar, sections, children }: { sidebar: ReactNode; sections: SidebarSection[]; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    // It takes back the page's padding.
    <div
      className={cn(
        "grid items-start gap-6 lg:-m-8 lg:h-[calc(100dvh-var(--top-bar-height))] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch lg:gap-0",
        open ? "lg:grid-cols-[18rem_minmax(0,1fr)]" : "lg:grid-cols-[auto_minmax(0,1fr)]",
      )}
    >
      <aside className="flex flex-col gap-4 rounded-lg border bg-muted p-4 lg:min-h-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:py-8 lg:pl-8">
        <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {!open && (
            <ul className="flex flex-row gap-1 lg:flex-col lg:gap-3">
              {sections.map(({ name, icon }) => (
                <li key={name}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={name} onClick={() => setOpen(true)}>
                        {icon}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{name}</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          <div hidden={!open} className="flex flex-col gap-4">
            {sidebar}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="self-start text-muted-foreground"
          aria-label={open ? "Hide the sidebar" : "Show the sidebar"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
      </aside>
      <div className="flex min-w-0 flex-col gap-6 lg:min-h-0 lg:overflow-y-auto lg:p-8">{children}</div>
    </div>
  );
}
