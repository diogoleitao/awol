"use client";

import { ArrowDown, ArrowUp, History, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type ComponentGroup,
  dashboardViewOf,
  type Filters,
  filterOptionsOf,
  INITIAL_TABLE_STATE,
  NO_FILTERS,
  nextSort,
  PAGE_SIZES,
  type Sort,
  type SortColumn,
  type TableState,
} from "../awol/dashboard-view.ts";
import type { ComponentDrift, ComponentRow, Drift, LastScan, SupportDates } from "../awol/page-model.ts";
import { STATUSES, type Status } from "../awol/status.ts";
import { formatTime } from "./format.ts";

// One of the table's columns: its heading, the column it sorts on, if it
// sorts, and what its cell shows for a Component.
type Column = { heading: string; sortsOn?: SortColumn; className?: string; cell: (component: ComponentRow) => ReactNode };

const TABLE_COLUMNS: Column[] = [
  { heading: "Service", sortsOn: "service", cell: (component) => component.service },
  { heading: "Product", sortsOn: "product", cell: (component) => component.product },
  { heading: "Region", sortsOn: "region", cell: (component) => component.region },
  { heading: "Identifier", sortsOn: "identifier", className: "font-mono", cell: (component) => component.identifier },
  { heading: "Version", sortsOn: "version", className: "font-mono", cell: (component) => component.version },
  { heading: "Release Cycle", sortsOn: "releaseCycle", className: "font-mono", cell: (component) => component.releaseCycle },
  { heading: "Status", sortsOn: "status", cell: (component) => <StatusCell component={component} /> },
  { heading: "Drift", cell: (component) => <DriftFigures drift={component.drift} /> },
  { heading: "Cycle released", sortsOn: "cycleReleaseDate", cell: (component) => component.cycleReleaseDate },
  { heading: "Active support ends", sortsOn: "activeSupportEnd", cell: (component) => component.activeSupportEnd },
  {
    heading: "End of life",
    sortsOn: "endOfLife",
    cell: (component) => (
      <>
        <EndOfLife component={component} />
        <SourceDates component={component} field="endOfLife" />
      </>
    ),
  },
  {
    heading: "Extended Support ends",
    sortsOn: "extendedSupportEnd",
    cell: (component) => (
      <>
        {component.extendedSupportEnd}
        <SourceDates component={component} field="extendedSupportEnd" />
      </>
    ),
  },
  { heading: "At End of life", sortsOn: "extendedSupport", cell: (component) => component.extendedSupport },
];

const COLUMNS = TABLE_COLUMNS.length;

// The last Scan's counts per Status and its Components, filtered, grouped,
// sorted and paged in the browser, so that none of it reads AWS. Any change
// but a page goes back to the first page; a live update keeps the page.
export function ScanTable({ scan }: { scan: LastScan }) {
  const [state, setState] = useState<TableState>(INITIAL_TABLE_STATE);
  const { filters, grouped, sort, page } = state;
  const options = filterOptionsOf(scan);
  const view = dashboardViewOf(scan, state);
  const anyChosen = Object.values(filters).some((chosen) => chosen.length > 0);

  // A live update that leaves fewer pages moves the table to the last one,
  // so that a later one with more does not move it back.
  if (view.page !== page.index) setState((current) => ({ ...current, page: { ...current.page, index: view.page } }));

  // Changes `state` with `update`, back on the first page.
  function change(update: (current: TableState) => Partial<TableState>) {
    setState((current) => {
      const next = { ...current, ...update(current) };
      return { ...next, page: { ...next.page, index: 0 } };
    });
  }

  // Chooses `value` in the filter on `column`, or unchooses it.
  function toggle<K extends keyof Filters>(column: K, value: Filters[K][number]) {
    change(({ filters }) => {
      const chosen = filters[column] as Filters[K][number][];
      return {
        filters: { ...filters, [column]: chosen.includes(value) ? chosen.filter((other) => other !== value) : [...chosen, value] },
      };
    });
  }

  // Shows the page at `index`, keeping everything else.
  function goTo(index: number) {
    setState((current) => ({ ...current, page: { ...current.page, index } }));
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <FilterRow label="Service" values={options.services} chosen={filters.services} onToggle={(value) => toggle("services", value)} />
        <FilterRow label="Product" values={options.products} chosen={filters.products} onToggle={(value) => toggle("products", value)} />
        <FilterRow label="Region" values={options.regions} chosen={filters.regions} onToggle={(value) => toggle("regions", value)} />
        <FilterRow label="Status" values={options.statuses} chosen={filters.statuses} onToggle={(value) => toggle("statuses", value)} />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleButton pressed={grouped} onClick={() => change(() => ({ grouped: !grouped }))}>
            Group by Product and Release Cycle
          </ToggleButton>
          {anyChosen && (
            <Button variant="outline" size="sm" onClick={() => change(() => ({ filters: NO_FILTERS }))}>
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
      {/* Room under the last row for the footer, which stays at the bottom of
          the window. */}
      <div className="pb-16">
        <Table>
          <TableHeader>
            <TableRow>
              {TABLE_COLUMNS.map(({ heading, sortsOn }) =>
                sortsOn === undefined ? (
                  <TableHead key={heading}>{heading}</TableHead>
                ) : (
                  <SortableHead
                    key={heading}
                    heading={heading}
                    direction={sort?.column === sortsOn ? sort.direction : undefined}
                    onClick={() => change(({ sort }) => ({ sort: nextSort(sort, sortsOn) }))}
                  />
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            <SizingRow components={scan.components} />
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
        <div className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-background px-8 py-3 text-sm">
          {view.pages > 1 && (
            <>
              <Button variant="outline" size="sm" disabled={view.page === 0} onClick={() => goTo(view.page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={view.page === view.pages - 1} onClick={() => goTo(view.page + 1)}>
                Next
              </Button>
            </>
          )}
          {view.range.of > PAGE_SIZES[0] && (
            <>
              <span className="tabular-nums">
                {view.range.from}-{view.range.to} of {view.range.of} Components
              </span>
              <span className="text-muted-foreground">Per page</span>
              {PAGE_SIZES.map((size) => (
                <ToggleButton key={size} pressed={page.size === size} onClick={() => change(() => ({ page: { ...page, size } }))}>
                  {size}
                </ToggleButton>
              ))}
            </>
          )}
          {sort === undefined && <span className="text-muted-foreground">Sorted by Urgency order</span>}
        </div>
      </div>
    </>
  );
}

// A column heading that sorts the table on its column, with an arrow the way
// it sorts while it does.
function SortableHead({
  heading,
  direction,
  onClick,
}: {
  heading: string;
  direction: Sort["direction"] | undefined;
  onClick: () => void;
}) {
  return (
    <TableHead aria-sort={direction}>
      <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={onClick}>
        {heading}
        {direction === "ascending" && <ArrowUp className="size-3.5" />}
        {direction === "descending" && <ArrowDown className="size-3.5" />}
      </button>
    </TableHead>
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

// A group's rows on the page, under a row naming its Product and Release
// Cycle and how many Components it has on every page when grouped.
function Group({ group, grouped }: { group: ComponentGroup; grouped: boolean }) {
  const { count } = group;
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
        <ComponentTableRow key={keyOf(component)} component={component} />
      ))}
    </>
  );
}

function keyOf(component: ComponentRow): string {
  return `${component.service}/${component.region}/${component.identifier}`;
}

// A row with no height that holds every Component of the last Scan in each
// column, so that each column is as wide as its widest cell on any page and
// keeps its width from page to page.
function SizingRow({ components }: { components: ComponentRow[] }) {
  return (
    <TableRow aria-hidden className="border-0 hover:bg-transparent">
      {TABLE_COLUMNS.map(({ heading, className, cell }) => (
        <TableCell key={heading} className={cn("py-0", className)}>
          <div className="invisible h-0 overflow-hidden">
            {components.map((component) => (
              <div key={keyOf(component)}>{cell(component)}</div>
            ))}
          </div>
        </TableCell>
      ))}
    </TableRow>
  );
}

// One Component's row: its Status with any Stale or disagreeing sources
// marked, its Drift, and the dates of its Release Cycle.
function ComponentTableRow({ component }: { component: ComponentRow }) {
  return (
    <TableRow>
      {TABLE_COLUMNS.map(({ heading, className, cell }) => (
        <TableCell key={heading} className={className}>
          {cell(component)}
        </TableCell>
      ))}
    </TableRow>
  );
}

function StatusCell({ component }: { component: ComponentRow }) {
  return (
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
