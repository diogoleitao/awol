"use client";

import { History, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ComponentGroup, dashboardViewOf, type Filters, filterOptionsOf, NO_FILTERS } from "../awol/dashboard-view.ts";
import type { ComponentDrift, ComponentRow, Drift, LastScan, SupportDates } from "../awol/page-model.ts";
import { STATUSES, type Status } from "../awol/status.ts";
import { formatTime } from "./format.ts";

// How many columns the table has, one per TableHead below.
const COLUMNS = 13;

// The last Scan's counts per Status and its Components, filtered and grouped
// in the browser, so that neither reads AWS.
export function ScanTable({ scan }: { scan: LastScan }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [grouped, setGrouped] = useState(false);
  const options = filterOptionsOf(scan);
  const view = dashboardViewOf(scan, filters, grouped);
  const anyChosen = Object.values(filters).some((chosen) => chosen.length > 0);

  // Chooses `value` in the filter on `column`, or unchooses it.
  function toggle<K extends keyof Filters>(column: K, value: Filters[K][number]) {
    setFilters((current) => {
      const chosen = current[column] as Filters[K][number][];
      return {
        ...current,
        [column]: chosen.includes(value) ? chosen.filter((other) => other !== value) : [...chosen, value],
      };
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <FilterRow label="Service" values={options.services} chosen={filters.services} onToggle={(value) => toggle("services", value)} />
        <FilterRow label="Product" values={options.products} chosen={filters.products} onToggle={(value) => toggle("products", value)} />
        <FilterRow label="Region" values={options.regions} chosen={filters.regions} onToggle={(value) => toggle("regions", value)} />
        <FilterRow label="Status" values={options.statuses} chosen={filters.statuses} onToggle={(value) => toggle("statuses", value)} />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleButton pressed={grouped} onClick={() => setGrouped(!grouped)}>
            Group by Product and Release Cycle
          </ToggleButton>
          {anyChosen && (
            <Button variant="outline" size="sm" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </div>
      </div>
      <ul className="flex flex-wrap gap-3">
        {STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-2 rounded-lg border px-4 py-2">
            <span className="text-2xl font-semibold tabular-nums">{view.counts[status]}</span>
            <StatusBadge status={status} />
          </li>
        ))}
      </ul>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Identifier</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Release Cycle</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Drift</TableHead>
            <TableHead>Cycle released</TableHead>
            <TableHead>Active support ends</TableHead>
            <TableHead>End of life</TableHead>
            <TableHead>Extended Support ends</TableHead>
            <TableHead>At End of life</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.groups.every((group) => group.components.length === 0) && (
            <TableRow>
              <TableCell colSpan={COLUMNS} className="text-muted-foreground">
                No Component passes the filters.
              </TableCell>
            </TableRow>
          )}
          {view.groups.map((group) => (
            <Group key={group.key} group={group} grouped={grouped} />
          ))}
        </TableBody>
      </Table>
    </>
  );
}

// The values a filter offers, each chosen or not.
function FilterRow<T extends string>({
  label,
  values,
  chosen,
  onToggle,
}: {
  label: string;
  values: T[];
  chosen: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-sm text-muted-foreground">{label}</span>
      {values.map((value) => (
        <ToggleButton key={value} pressed={chosen.includes(value)} onClick={() => onToggle(value)}>
          {value}
        </ToggleButton>
      ))}
    </div>
  );
}

// A button that stays pressed while its value is chosen.
function ToggleButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant={pressed ? "default" : "outline"} size="sm" aria-pressed={pressed} onClick={onClick}>
      {children}
    </Button>
  );
}

// A group's rows, under a row naming its Product and Release Cycle and how
// many Components it has when grouped.
function Group({ group, grouped }: { group: ComponentGroup; grouped: boolean }) {
  const count = group.components.length;
  return (
    <>
      {grouped && (
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableCell colSpan={COLUMNS} className="font-medium">
            {group.product}{" "}
            {group.releaseCycle === undefined ? (
              <span className="text-muted-foreground">no Release Cycle</span>
            ) : (
              <span className="font-mono">{group.releaseCycle}</span>
            )}
            <span className="text-muted-foreground">
              {" "}
              · {count} {count === 1 ? "Component" : "Components"}
            </span>
          </TableCell>
        </TableRow>
      )}
      {group.components.map((component) => (
        <ComponentTableRow key={`${component.service}/${component.region}/${component.identifier}`} component={component} />
      ))}
    </>
  );
}

// One Component's row: its Status with any Stale or disagreeing sources
// marked, its Drift, and the dates of its Release Cycle.
function ComponentTableRow({ component }: { component: ComponentRow }) {
  return (
    <TableRow>
      <TableCell>{component.service}</TableCell>
      <TableCell>{component.product}</TableCell>
      <TableCell>{component.region}</TableCell>
      <TableCell className="font-mono">{component.identifier}</TableCell>
      <TableCell className="font-mono">{component.version}</TableCell>
      <TableCell className="font-mono">{component.releaseCycle}</TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={component.status} />
          {component.stale !== undefined && (
            <Badge variant="outline" className="border-sky-600 text-sky-700 dark:text-sky-400">
              <History />
              Stale since {formatTime(component.stale.lastReadAt)}
            </Badge>
          )}
          {component.datesDisagree && (
            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
              <TriangleAlert />
              Sources disagree
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <DriftFigures drift={component.drift} />
      </TableCell>
      <TableCell>{component.cycleReleaseDate}</TableCell>
      <TableCell>{component.activeSupportEnd}</TableCell>
      <TableCell>
        <EndOfLife component={component} />
        <SourceDates component={component} field="endOfLife" />
      </TableCell>
      <TableCell>
        {component.extendedSupportEnd}
        <SourceDates component={component} field="extendedSupportEnd" />
      </TableCell>
      <TableCell>{component.extendedSupport}</TableCell>
    </TableRow>
  );
}

function EndOfLife({ component }: { component: ComponentRow }) {
  if (component.endOfLife !== undefined) return component.endOfLife;
  if (component.status === "Current") return <span className="text-muted-foreground">End of life not announced</span>;
  return null;
}

// Each source's own date for `field`, under the one that decides Status, for
// the sources that give one.
function SourceDates({ component, field }: { component: ComponentRow; field: keyof SupportDates }) {
  const dates = Object.entries(component.sources).flatMap(([source, dates]) =>
    dates[field] === undefined ? [] : [{ source, date: dates[field] }],
  );
  if (dates.length === 0) return null;
  return (
    <ul className="text-xs text-muted-foreground">
      {dates.map(({ source, date }) => (
        <li key={source}>
          {source === "aws" ? "AWS" : source} {date}
        </li>
      ))}
    </ul>
  );
}

const DRIFT_FIGURES: [keyof ComponentDrift, string][] = [
  ["latestPatch", "Latest patch"],
  ["newestCycle", "Newest cycle"],
  ["newestOffered", "Newest offered"],
];

// Each Drift figure: the version the Component is behind, or that it has no
// Drift there, or that the figure is not available.
function DriftFigures({ drift }: { drift: ComponentDrift }) {
  return (
    <ul className="text-xs">
      {DRIFT_FIGURES.map(([figure, label]) => (
        <li key={figure}>
          <span className="text-muted-foreground">{label}</span> <DriftValue drift={drift[figure]} />
        </li>
      ))}
    </ul>
  );
}

function DriftValue({ drift }: { drift: Drift }) {
  if (drift.kind === "behind") return <span className="font-mono">{drift.version}</span>;
  return <span className="text-muted-foreground">{drift.kind === "none" ? "no Drift" : "not available"}</span>;
}

const STATUS_CLASSES: Record<Status, string> = {
  AWOL: "border-transparent bg-destructive text-white",
  "Falling behind": "border-transparent bg-amber-500 text-black",
  Current: "border-transparent bg-emerald-600 text-white",
  Untracked: "text-muted-foreground",
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {status}
    </Badge>
  );
}
