"use client";

import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CollapsibleCard } from "./collapsible-card.tsx";
import type { SidebarSection } from "./sidebar-layout.tsx";

// The heading atop a sidebar of filters, with what they do, `description`,
// and Clear filters, which unchooses every value, `onClear`, and waits
// until any is chosen, `anyChosen`.
export function FiltersHeading({ description, anyChosen, onClear }: { description: string; anyChosen: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-medium">Filters</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
      {/* Always there, so that the cards under it never move. */}
      <Button variant="outline" size="sm" className="mt-2 self-start" disabled={!anyChosen} onClick={onClear}>
        <X />
        Clear filters
      </Button>
    </div>
  );
}

// A filter's card, open at first, holding its values, `children`, under its
// `section`'s name and icon, `count`, how many chosen values it offers, when
// any, and any `description`.
export function FilterCard({
  section,
  count,
  description,
  children,
}: {
  section: SidebarSection;
  count: number;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CollapsibleCard
      icon={section.icon}
      title={
        <>
          {section.name} {count > 0 && <span className="tabular-nums font-normal text-muted-foreground">({count})</span>}
        </>
      }
      description={description}
      defaultOpen
    >
      {children}
    </CollapsibleCard>
  );
}

// The `values` a filter offers, one per line and as wide as its card, each
// chosen or not.
export function FilterValues<T extends string>({ values, chosen, onToggle }: { values: readonly T[]; chosen: T[]; onToggle: (value: T) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {values.map((value) => (
        <FilterValue key={value} chosen={chosen.includes(value)} onClick={() => onToggle(value)}>
          {value}
        </FilterValue>
      ))}
    </div>
  );
}

// A filter's value, which stays pressed, lightly filled and ticked, while it
// is chosen.
export function FilterValue({ chosen, onClick, children }: { chosen: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={chosen}
      className={cn("justify-start", chosen && "bg-accent text-accent-foreground dark:bg-accent")}
      onClick={onClick}
    >
      <span className="flex-1 truncate text-left">{children}</span>
      {chosen && <Check />}
    </Button>
  );
}
