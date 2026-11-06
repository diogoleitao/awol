import { ChevronRight, Globe } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CollapsibleCard } from "./collapsible-card.tsx";

// The regions enabled in the account, which the last Discovery read, in a
// card that opens to show them nested under the first part of their names,
// each group closed until opened, with how many regions it has.
export function RegionsCard({ regions }: { regions: string[] }) {
  return (
    <CollapsibleCard
      icon={<Globe />}
      title={
        <>
          Regions <span className="tabular-nums font-normal text-muted-foreground">({regions.length})</span>
        </>
      }
      description="Enabled in this account. Only these can hold resources."
    >
      <ul className="flex flex-col gap-1 font-mono text-sm">
        {regionGroupsOf(regions).map(([prefix, group]) => (
          <li key={prefix}>
            <Collapsible className="group/region">
              <CollapsibleTrigger className="flex items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]/region:rotate-90" />
                {prefix} <span className="tabular-nums">({group.length})</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="mt-1 mb-1 ml-1.5 flex flex-col gap-0.5 border-l pl-3">
                  {group.map((region) => (
                    <li key={region}>{region}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </CollapsibleCard>
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
