"use client";

import { Check, Eye } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DiscoveredServiceRow, SupportedService } from "../awol/page-model.ts";
import { chooseMonitoredServices } from "./actions.ts";
import { CollapsibleCard } from "./collapsible-card.tsx";

// Chooses the account's Monitored services among the supported services
// Discovery counts, in alphabetical order, each with how many resources it
// found, in a card that opens to change the current choice, `monitored`. It
// starts open until a choice has been made, and saves only a ticked set that
// differs from the current choice.
export function MonitoredServicesForm({ services, monitored }: { services: DiscoveredServiceRow[]; monitored?: SupportedService[] }) {
  const [ticked, setTicked] = useState<string[]>(monitored ?? []);
  const current: string[] = monitored ?? [];
  const changed = ticked.length !== current.length || ticked.some((service) => !current.includes(service));
  const tick = (service: string, checked: boolean) =>
    setTicked((was) => (checked ? [...was, service] : was.filter((other) => other !== service)));
  return (
    <CollapsibleCard
      icon={<Eye />}
      title={
        <>
          Services <span className="tabular-nums font-normal text-muted-foreground">({monitored?.length ?? 0})</span>
        </>
      }
      description={monitored === undefined ? "The services awol monitors. None chosen yet." : "The services awol monitors. Scans read only these."}
      defaultOpen={monitored === undefined}
    >
      <form action={chooseMonitoredServices} className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y rounded-md border">
          {services.toSorted((a, b) => a.service.localeCompare(b.service)).map(({ service, count }) => (
            <li key={service}>
              <label className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50">
                <Checkbox
                  name="service"
                  value={service}
                  checked={ticked.includes(service)}
                  onCheckedChange={(checked) => tick(service, checked === true)}
                />
                <span className="flex-1">{service}</span>
                <span className="tabular-nums text-muted-foreground">
                  {count} {count === 1 ? "resource" : "resources"}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <Submit changed={changed} />
      </form>
    </CollapsibleCard>
  );
}

// The Save button, enabled once the ticked set differs from the current
// choice, `changed`, and not while the form is being sent.
function Submit({ changed }: { changed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" className="self-start" disabled={!changed || pending}>
      <Check />
      Save
    </Button>
  );
}
