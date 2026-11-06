"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// A section of a sidebar, as the hidden sidebar shows it: its icon, named on
// hover.
export type SidebarSection = { name: string; icon: ReactNode };

// A page with `sidebar` on its left, above it on narrow screens, and
// `children` beside it. A button below it hides the sidebar, leaving the icon
// of each of its `sections`, named on hover, and the button, any of which
// shows it again; hiding it keeps what is open or ticked in it. It starts shown, and
// live updates keep it as it is.
export function SidebarLayout({ sidebar, sections, children }: { sidebar: ReactNode; sections: SidebarSection[]; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={open ? "grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]" : "grid items-start gap-4 lg:grid-cols-[auto_minmax(0,1fr)]"}>
      {/* On wide screens the sidebar runs from under the top bar to the
          bottom of the window, flush with the page's left edge: it takes
          back the page's padding, and 57px is the top bar's height. */}
      <aside className="flex flex-col gap-4 rounded-lg border bg-muted p-4 lg:-my-8 lg:-ml-8 lg:min-h-[calc(100dvh-57px)] lg:rounded-none lg:border-y-0 lg:border-l-0 lg:py-8 lg:pl-8">
        {!open && (
          <ul className="flex flex-row gap-1 lg:flex-col">
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
      {children}
    </div>
  );
}
