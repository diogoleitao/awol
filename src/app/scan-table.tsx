"use client";

import { Activity, ArrowDown, ArrowUp, Globe, Package, Server } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type ComponentGroup,
  dashboardViewOf,
  type Filters,
  filterOptionsOf,
  type GroupBy,
  type GroupLevel,
  groupByOptionsOf,
  levelKeyOf,
  NO_FILTERS,
  nextSort,
  PAGE_SIZES,
  type Sort,
  type SortColumn,
  searchParamsOf,
  type TableState,
  tableStateOf,
  toggledGroupBy,
  withQuery,
} from "../awol/dashboard-view.ts";
import { componentPathOf } from "../awol/component-page.ts";
import type { ComponentRow, LastScan } from "../awol/page-model.ts";
import { STATUSES, type Status } from "../awol/status.ts";
import { DateWithSources, StatusCell } from "./component-cells.tsx";
import { FilterCard, FiltersHeading, FilterValues } from "./filter-card.tsx";
import { useColumnWidths } from "./resizable-columns.tsx";
import { SidebarLayout, type SidebarSection } from "./sidebar-layout.tsx";
import { SCROLLING_TABLE, STICKY_HEADER, TABLE_AREA } from "./table-area.ts";
import { toggledIn, useUrlState } from "./url-state.ts";

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

const HEADINGS = TABLE_COLUMNS.map(({ heading }) => heading);

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
  const [state, setState, query] = useUrlState(tableStateOf, searchParamsOf);
  const { filters, search, sort, page } = state;
  const options = filterOptionsOf(scan);
  const view = dashboardViewOf(scan, state);
  const anyChosen = Object.values(filters).some((chosen) => chosen.length > 0);
  const columns = useColumnWidths("dashboard", HEADINGS);

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
    change(({ filters }) => ({ filters: toggledIn(filters, column, value) }));
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
          <FiltersHeading
            description="Show only the Components that match every filter. A filter with nothing chosen lets every Component through."
            anyChosen={anyChosen}
            onClear={() => change(() => ({ filters: NO_FILTERS }))}
          />
          <FilterCard section={FILTER_SECTIONS.products} count={view.chosenCounts.products}>
            <FilterValues values={options.products} chosen={filters.products} onToggle={(value) => toggle("products", value)} />
          </FilterCard>
          <FilterCard section={FILTER_SECTIONS.regions} count={view.chosenCounts.regions}>
            <FilterValues values={options.regions} chosen={filters.regions} onToggle={(value) => toggle("regions", value)} />
          </FilterCard>
          <FilterCard section={FILTER_SECTIONS.services} count={view.chosenCounts.services}>
            <FilterValues values={options.services} chosen={filters.services} onToggle={(value) => toggle("services", value)} />
          </FilterCard>
          <FilterCard section={FILTER_SECTIONS.statuses} count={view.chosenCounts.statuses}>
            <FilterValues values={options.statuses} chosen={filters.statuses} onToggle={(value) => toggle("statuses", value)} />
          </FilterCard>
        </>
      }
    >
      {children}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUSES.map((status) => (
          <li key={status} className={cn("flex items-center gap-3 rounded-lg border-2 bg-zinc-950 px-6 py-4", STATUS_TILE_CLASSES[status])}>
            <span className="text-4xl font-semibold tabular-nums">{scan.counts[status]}</span>
            <span className="text-base font-medium">{status}</span>
          </li>
        ))}
      </ul>
      <h2 className="font-medium">Components</h2>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => change(() => ({ search: event.target.value }))}
            className="h-8 w-80 rounded-md border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Group by</span>
          {/* Toggled from what the table groups by, not from the URL, so a
              grouping the table does not offer is dropped, not kept. */}
          {groupByOptionsOf(scan).map((by) => (
            <ToggleButton key={by} pressed={view.groupBy.includes(by)} onClick={() => change(() => ({ groupBy: toggledGroupBy(view.groupBy, by) }))}>
              {GROUP_BY_LABELS[by]}
            </ToggleButton>
          ))}
        </div>
      </div>
      <div className={TABLE_AREA}>
        <Table ref={columns.ref} className={columns.tableClassName} style={columns.tableStyle} containerClassName={SCROLLING_TABLE}>
          <TableHeader className={STICKY_HEADER}>
            <TableRow>
              {TABLE_COLUMNS.map(({ heading, sortsOn }) => (
                <SortableHead
                  key={heading}
                  heading={heading}
                  direction={sort.column === sortsOn ? sort.direction : undefined}
                  style={columns.head(heading)}
                  resizer={columns.resizer(heading)}
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
            {view.groups.map((group, index) => (
              <Group key={group.key} group={group} fromLevel={firstNewLevel(view.groups[index - 1], group)} query={query} />
            ))}
          </TableBody>
        </Table>
        {/* Right under the table's last row, or, while the table runs past
            what its area leaves it, under the table on wide screens and at
            the bottom of the window on narrow ones. */}
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
              {/* As wide on every page as on the widest, holding the last
                  Component's number on both sides, so that what follows it
                  never moves. */}
              <span className="grid tabular-nums">
                <span className="col-start-1 row-start-1">
                  {view.range.from}-{view.range.to} of {view.range.of}
                </span>
                <span aria-hidden className="invisible col-start-1 row-start-1">
                  {view.range.of}-{view.range.of} of {view.range.of}
                </span>
              </span>
              <span className="text-muted-foreground">Per page</span>
              {PAGE_SIZES.map((size) => (
                <ToggleButton key={size} pressed={page.size === size} onClick={() => change(() => ({ page: { ...page, size } }))}>
                  {size}
                </ToggleButton>
              ))}
            </>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}

// A column heading that sorts the table on its column, with an arrow the way
// it sorts while it does, its `style` and its column's `resizer`.
function SortableHead({
  heading,
  direction,
  style,
  resizer,
  onClick,
}: {
  heading: string;
  direction: Sort["direction"] | undefined;
  style?: CSSProperties;
  resizer: ReactNode;
  onClick: () => void;
}) {
  return (
    <TableHead aria-sort={direction} className="relative" style={style}>
      <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={onClick}>
        {heading}
        {direction === "ascending" && <ArrowUp className="size-3.5" />}
        {direction === "descending" && <ArrowDown className="size-3.5" />}
      </button>
      {resizer}
    </TableHead>
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

// What each grouping is called.
const GROUP_BY_LABELS: Record<GroupBy, string> = {
  environment: "Environment",
  project: "Project",
  releaseCycle: "Product and Release Cycle",
};

// The first of `group`'s levels that the group before it on the page,
// `previous`, is not in: its first level for the page's first group.
function firstNewLevel(previous: ComponentGroup | undefined, group: ComponentGroup): number {
  const index = group.levels.findIndex((level, depth) => previous === undefined || levelKeyOf(level) !== levelKeyOf(previous.levels[depth]!));
  return index === -1 ? group.levels.length : index;
}

// A group's rows on the page, under a row for each of its levels from
// `fromLevel`, the levels the group before it is not in, each naming what
// it is of and how many Components it has on every page.
function Group({ group, fromLevel, query }: { group: ComponentGroup; fromLevel: number; query: string }) {
  return (
    <>
      {group.levels.slice(fromLevel).map((level, index) => (
        <GroupRow key={levelKeyOf(level)} count={level.count} depth={fromLevel + index}>
          <LevelName level={level} />
        </GroupRow>
      ))}
      {group.components.map((component) => (
        <ComponentTableRow key={keyOf(component)} component={component} query={query} />
      ))}
    </>
  );
}

// What a group's `level` is of.
function LevelName({ level }: { level: GroupLevel }) {
  if (level.by === "environment") return level.environment ?? <span className="text-muted-foreground">No Environment</span>;
  if (level.by === "project") return level.project ?? <span className="text-muted-foreground">No Project</span>;
  return (
    <>
      {level.product}{" "}
      {level.releaseCycle === undefined ? (
        <span className="text-muted-foreground">no Release Cycle</span>
      ) : (
        <span className="font-mono">{level.releaseCycle}</span>
      )}
    </>
  );
}

// How far in a group's row at each depth is, and its shade: the outermost
// darkest and not in at all.
const DEPTH_CLASSES = [
  { row: "bg-muted/50 hover:bg-muted/50", cell: "" },
  { row: "bg-muted/30 hover:bg-muted/30", cell: "pl-6" },
  { row: "bg-muted/15 hover:bg-muted/15", cell: "pl-10" },
];

// A row over a group's rows at `depth`: what it is of, `children`, and its
// `count` of Components.
function GroupRow({ count, depth, children }: { count: number; depth: number; children: ReactNode }) {
  const classes = DEPTH_CLASSES[Math.min(depth, DEPTH_CLASSES.length - 1)]!;
  return (
    <TableRow className={classes.row}>
      <TableCell colSpan={COLUMNS} className={cn("font-medium", classes.cell)}>
        {children}
        <span className="text-muted-foreground">
          {" "}
          · {count} {count === 1 ? "Component" : "Components"}
        </span>
      </TableCell>
    </TableRow>
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
