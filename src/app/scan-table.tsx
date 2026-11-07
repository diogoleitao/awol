"use client";

import { Activity, ArrowDown, ArrowUp, Globe, Package, Server, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type ComponentGroup,
  dashboardViewOf,
  type Filters,
  filterOptionsOf,
  NO_FILTERS,
  nextSort,
  PAGE_SIZES,
  type Sort,
  type SortColumn,
  searchParamsOf,
  type TableState,
  tableStateOf,
  withQuery,
} from "../awol/dashboard-view.ts";
import { componentPathOf } from "../awol/component-page.ts";
import type { ComponentRow, LastScan } from "../awol/page-model.ts";
import { STATUSES, type Status } from "../awol/status.ts";
import { CollapsibleCard } from "./collapsible-card.tsx";
import { DateWithSources, StatusCell } from "./component-cells.tsx";
import { SidebarLayout, type SidebarSection } from "./sidebar-layout.tsx";

// One of the table's columns: its heading, the column it sorts on, and what
// its cell shows for a Component, with `query`, the table's state as its URL
// keeps it.
type Column = { heading: string; sortsOn: SortColumn; className?: string; cell: (component: ComponentRow, query: string) => ReactNode };

// The essential columns; a Component's page shows the rest.
const TABLE_COLUMNS: Column[] = [
  {
    heading: "Identifier",
    sortsOn: "identifier",
    className: "font-mono",
    // Not prefetched, so that a page of the table, and its sizing row with
    // every Component, does not read the page model once per Component.
    cell: (component, query) => (
      <Link href={withQuery(componentPathOf(component), query)} prefetch={false} className="underline underline-offset-4">
        {component.identifier}
      </Link>
    ),
  },
  { heading: "Product", sortsOn: "product", cell: (component) => component.product },
  { heading: "Region", sortsOn: "region", cell: (component) => component.region },
  { heading: "Version", sortsOn: "version", className: "font-mono", cell: (component) => component.version },
  { heading: "Status", sortsOn: "status", cell: (component) => <StatusCell component={component} /> },
  { heading: "End of life", sortsOn: "endOfLife", cell: (component) => <DateWithSources component={component} field="endOfLife" /> },
];

const COLUMNS = TABLE_COLUMNS.length;

// The dashboard's filters, as sections of its sidebar, in alphabetical
// order.
const FILTER_SECTIONS = {
  products: { name: "Product", icon: <Package /> },
  regions: { name: "Region", icon: <Globe /> },
  services: { name: "Service", icon: <Server /> },
  statuses: { name: "Status", icon: <Activity /> },
} satisfies Record<keyof Filters, SidebarSection>;

// The last Scan's counts per Status and its Components, under `children`,
// with a sidebar of its filters, filtered, searched, grouped, sorted and
// paged in the browser, so that none of it reads AWS. Any change but a page
// goes back to the first page; a live update keeps the page.
//
// The page's URL keeps the table's state, replaced on each change rather
// than added to the history, so that going back to the dashboard, as from a
// Component's page, reloading it or opening a link to it shows the table as
// it was.
export function ScanTable({ scan, children }: { scan: LastScan; children?: ReactNode }) {
  const searchParams = useSearchParams();
  const [state, setState] = useState<TableState>(() => tableStateOf(searchParams));
  const { filters, search, grouped, sort, page } = state;
  const query = searchParamsOf(state).toString();
  const options = filterOptionsOf(scan);
  const view = dashboardViewOf(scan, state);
  const anyChosen = Object.values(filters).some((chosen) => chosen.length > 0);

  useEffect(() => {
    window.history.replaceState(null, "", withQuery(window.location.pathname, query));
  }, [query]);

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
    <SidebarLayout
      sections={Object.values(FILTER_SECTIONS)}
      sidebar={
        <>
          <div className="flex flex-col gap-1">
            <h2 className="font-medium">Filters</h2>
            <p className="text-xs text-muted-foreground">
              Show only the Components that match every filter. A filter with nothing chosen lets every Component through.
            </p>
            {/* Always there, so that the cards under it never move. */}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 self-start"
              disabled={!anyChosen}
              onClick={() => change(() => ({ filters: NO_FILTERS }))}
            >
              <X />
              Clear filters
            </Button>
          </div>
          <FilterCard
            section={FILTER_SECTIONS.products}
            values={options.products}
            chosen={filters.products}
            count={view.chosenCounts.products}
            onToggle={(value) => toggle("products", value)}
          />
          <FilterCard
            section={FILTER_SECTIONS.regions}
            values={options.regions}
            chosen={filters.regions}
            count={view.chosenCounts.regions}
            onToggle={(value) => toggle("regions", value)}
          />
          <FilterCard
            section={FILTER_SECTIONS.services}
            values={options.services}
            chosen={filters.services}
            count={view.chosenCounts.services}
            onToggle={(value) => toggle("services", value)}
          />
          <FilterCard
            section={FILTER_SECTIONS.statuses}
            values={options.statuses}
            chosen={filters.statuses}
            count={view.chosenCounts.statuses}
            onToggle={(value) => toggle("statuses", value)}
          />
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        {children}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUSES.map((status) => (
            <li key={status} className={cn("flex items-center gap-3 rounded-lg border-2 bg-zinc-950 px-6 py-4", STATUS_TILE_CLASSES[status])}>
              <span className="text-4xl font-semibold tabular-nums">{view.counts[status]}</span>
              <span className="text-base font-medium">{status}</span>
            </li>
          ))}
        </ul>
        <h2 className="font-medium">Components</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="w-16 text-sm text-muted-foreground">Search</span>
            <input
              type="search"
              value={search}
              onChange={(event) => change(() => ({ search: event.target.value }))}
              className="h-8 w-80 rounded-md border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <div className="ml-auto">
            <ToggleButton pressed={grouped} onClick={() => change(() => ({ grouped: !grouped }))}>
              Group by Product and Release Cycle
            </ToggleButton>
          </div>
        </div>
        <div>
          <Table>
            <TableHeader>
              <TableRow>
                {TABLE_COLUMNS.map(({ heading, sortsOn }) => (
                  <SortableHead
                    key={heading}
                    heading={heading}
                    direction={sort?.column === sortsOn ? sort.direction : undefined}
                    onClick={() => change(({ sort }) => ({ sort: nextSort(sort, sortsOn) }))}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <SizingRow components={scan.components} query={query} />
              {view.groups.every((group) => group.components.length === 0) && (
                <TableRow>
                  <TableCell colSpan={COLUMNS} className="text-muted-foreground">
                    No Component passes the filters.
                  </TableCell>
                </TableRow>
              )}
              {view.groups.map((group) => (
                <Group key={group.key} group={group} grouped={grouped} query={query} />
              ))}
            </TableBody>
          </Table>
          {/* At the bottom of the window, under the table only, while the
              table runs past it. */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-background py-3 text-sm">
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
      </div>
    </SidebarLayout>
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

// A filter's card, open at first: the values it offers, one per line and as
// wide as the card, each chosen or not,
// under its `section`'s name and icon and `count`, how many chosen values it
// offers, when any.
function FilterCard<T extends string>({
  section,
  values,
  chosen,
  count,
  onToggle,
}: {
  section: SidebarSection;
  values: T[];
  chosen: T[];
  count: number;
  onToggle: (value: T) => void;
}) {
  return (
    <CollapsibleCard
      icon={section.icon}
      title={
        <>
          {section.name} {count > 0 && <span className="tabular-nums font-normal text-muted-foreground">({count})</span>}
        </>
      }
      defaultOpen
    >
      <div className="flex flex-col gap-2">
        {values.map((value) => (
          <ToggleButton key={value} pressed={chosen.includes(value)} className="justify-start" onClick={() => onToggle(value)}>
            {value}
          </ToggleButton>
        ))}
      </div>
    </CollapsibleCard>
  );
}

// A button that stays pressed while its value is chosen.
function ToggleButton({
  pressed,
  className,
  onClick,
  children,
}: {
  pressed: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button variant={pressed ? "default" : "outline"} size="sm" aria-pressed={pressed} className={className} onClick={onClick}>
      {children}
    </Button>
  );
}

// A group's rows on the page, under a row naming its Product and Release
// Cycle and how many Components it has on every page when grouped.
function Group({ group, grouped, query }: { group: ComponentGroup; grouped: boolean; query: string }) {
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
        <ComponentTableRow key={keyOf(component)} component={component} query={query} />
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
function SizingRow({ components, query }: { components: ComponentRow[]; query: string }) {
  return (
    <TableRow aria-hidden className="border-0 hover:bg-transparent">
      {TABLE_COLUMNS.map(({ heading, className, cell }) => (
        <TableCell key={heading} className={cn("py-0", className)}>
          <div className="invisible h-0 overflow-hidden">
            {components.map((component) => (
              <div key={keyOf(component)}>{cell(component, query)}</div>
            ))}
          </div>
        </TableCell>
      ))}
    </TableRow>
  );
}

// One Component's row: its essential columns, with its identifier a link to
// its page.
function ComponentTableRow({ component, query }: { component: ComponentRow; query: string }) {
  return (
    <TableRow>
      {TABLE_COLUMNS.map(({ heading, className, cell }) => (
        <TableCell key={heading} className={className}>
          {cell(component, query)}
        </TableCell>
      ))}
    </TableRow>
  );
}

// Each Status count's tile as a neon sign on a dark tile, its border and
// text lit and glowing in its Status's color, or unlit, dim grey, for
// Untracked, the same in light and dark mode.
const STATUS_TILE_CLASSES: Record<Status, string> = {
  AWOL: "border-red-500 text-red-400 shadow-[0_0_8px_#ef4444,0_0_24px_#ef444480,inset_0_0_12px_#ef444466] [text-shadow:0_0_6px_#ef4444,0_0_18px_#ef4444]",
  "Falling behind":
    "border-amber-400 text-amber-300 shadow-[0_0_8px_#fbbf24,0_0_24px_#fbbf2480,inset_0_0_12px_#fbbf2466] [text-shadow:0_0_6px_#fbbf24,0_0_18px_#fbbf24]",
  Current:
    "border-emerald-400 text-emerald-300 shadow-[0_0_8px_#34d399,0_0_24px_#34d39980,inset_0_0_12px_#34d39966] [text-shadow:0_0_6px_#34d399,0_0_18px_#34d399]",
  Untracked: "border-zinc-700 text-zinc-500",
};
