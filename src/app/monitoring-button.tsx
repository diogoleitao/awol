"use client";

import { Check, Eye } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiscoveredServiceRow, SupportedService } from "../awol/page-model.ts";
import { chooseMonitoredServices } from "./actions.ts";

// Monitoring in the top bar, with how many Monitored services are chosen,
// `monitored`: a button that opens the form to choose them among the
// Supported services the last Discovery counts, `services`, and closes once
// it saves, and which says what Monitored services are on hover or focus.
// Before any Discovery, `services` is undefined and the button waits for
// one.
export function MonitoringButton({ services, monitored }: { services?: DiscoveredServiceRow[]; monitored?: SupportedService[] }) {
  const [open, setOpen] = useState(false);
  const label = (
    <>
      <Eye />
      Monitoring <span className="tabular-nums text-muted-foreground">({monitored?.length ?? 0})</span>
    </>
  );
  if (services === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Focusable, so that the tooltip shows for the disabled button. */}
          <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <Button type="button" variant="ghost" size="sm" className="border" disabled>
              {label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Run a Discovery first</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="border">
              {label}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {monitored === undefined ? "The services awol monitors. None chosen yet." : "The services awol monitors. Scans read only these."}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <h2 className="font-medium">Monitored services</h2>
        <MonitoredServicesForm services={services} monitored={monitored} onSaved={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

// Chooses the account's Monitored services among the Supported services
// Discovery counts, in alphabetical order, each with how many resources it
// found, starting from the current choice, `monitored`. It saves only a
// ticked set that differs from the current choice, then calls `onSaved`.
function MonitoredServicesForm({
  services,
  monitored,
  onSaved,
}: {
  services: DiscoveredServiceRow[];
  monitored?: SupportedService[];
  onSaved: () => void;
}) {
  const [ticked, setTicked] = useState<string[]>(monitored ?? []);
  const current: string[] = monitored ?? [];
  const changed = ticked.length !== current.length || ticked.some((service) => !current.includes(service));
  const tick = (service: string, checked: boolean) =>
    setTicked((was) => (checked ? [...was, service] : was.filter((other) => other !== service)));
  async function save(formData: FormData) {
    await chooseMonitoredServices(formData);
    onSaved();
  }
  return (
    <form action={save} className="flex flex-col gap-4">
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
