"use client";

import { ChevronRight, Globe } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FilterCard, FilterValue } from "./filter-card.tsx";
import type { SidebarSection } from "./sidebar-layout.tsx";

export const REGIONS_SECTION: SidebarSection = { name: "Regions", icon: <Globe /> };

// The regions enabled in the account, which the last Discovery read, as a
// filter's card: each region a value, `chosen` or not, nested under the
// first part of its name with how many regions share it, each group closed
// until opened, and `count`, how many chosen regions the account enables.
export function RegionsCard({
  regions,
  chosen,
  count,
  onToggle,
}: {
  regions: string[];
  chosen: string[];
  count: number;
  onToggle: (region: string) => void;
}) {
  return (
    <FilterCard section={REGIONS_SECTION} count={count} description="Enabled in this account. Only these can hold resources.">
      <ul className="flex flex-col gap-1 text-sm">
        {regionGroupsOf(regions).map(([prefix, group]) => (
          <li key={prefix}>
            <Collapsible className="group/region">
              <CollapsibleTrigger className="flex items-center gap-1 rounded-sm font-mono text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/region:rotate-90" />
                {prefix} <span className="tabular-nums">({group.length})</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-1 mb-2 ml-1.5 flex flex-col gap-2 border-l pl-3 font-mono">
                  {group.map((region) => (
                    <li key={region} className="flex flex-col">
                      <FilterValue chosen={chosen.includes(region)} onClick={() => onToggle(region)}>
                        {region}
                      </FilterValue>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </FilterCard>
  );
}

// `regions` by the first part of their names, such as eu or us, the groups
// and the regions in each in alphabetical order.
function regionGroupsOf(regions: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const region of [...regions].sort()) {
    const prefix = region.split("-")[0]!;
    groups.set(prefix, [...(groups.get(prefix) ?? []), region]);
  }
  return [...groups];
}
