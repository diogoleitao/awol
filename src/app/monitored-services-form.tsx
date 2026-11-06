"use client";

import { Check } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { DiscoveredServiceRow, SupportedService } from "../awol/page-model.ts";
import { chooseMonitoredServices } from "./actions.ts";

// Chooses the account's Monitored services among the supported services
// Discovery counts, each with how many resources it found. `monitored` is
// the current choice, if one has been made.
export function MonitoredServicesForm({ services, monitored }: { services: DiscoveredServiceRow[]; monitored?: SupportedService[] }) {
  return (
    <form action={chooseMonitoredServices} className="flex flex-col gap-2">
      <h3 className="font-medium">Monitored services</h3>
      {monitored === undefined && (
        <p className="text-sm text-muted-foreground">Choose the services a Scan reads. Nothing is scanned until you do.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {services.map(({ service, count }) => (
          <label key={service} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="service" value={service} defaultChecked={monitored?.some((chosen) => chosen === service)} />
            {service} <span className="tabular-nums text-muted-foreground">({count})</span>
          </label>
        ))}
        <Submit />
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      <Check />
      Save
    </Button>
  );
}
