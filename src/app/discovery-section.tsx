"use client";

import { BadgeCheck, Eye, History } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  type DiscoveryFilters,
  discoveryFiltersOf,
  discoverySearchParamsOf,
  discoveryViewOf,
  MONITORING,
  NO_DISCOVERY_FILTERS,
  SUPPORT,
} from "../awol/discovery-view.ts";
import type { DiscoveredServiceRow, DiscoveryPart, DiscoveryResult, FailedDiscoveryPart, SupportedService } from "../awol/page-model.ts";
import { RerunFailedPartsButton } from "./discover-buttons.tsx";
import { FilterCard, FiltersHeading, FilterValues } from "./filter-card.tsx";
import { formatTime } from "./format.ts";
import { REGIONS_SECTION, RegionsCard } from "./regions-card.tsx";
import { useColumnWidths } from "./resizable-columns.tsx";
import { SidebarLayout, type SidebarSection } from "./sidebar-layout.tsx";
import { SCROLLING_TABLE, STICKY_HEADER, TABLE_AREA } from "./table-area.ts";
import { toggledIn, useUrlState } from "./url-state.ts";

const SUPPORT_SECTION: SidebarSection = { name: "Support", icon: <BadgeCheck /> };

const MONITORING_SECTION: SidebarSection = { name: "Monitoring", icon: <Eye /> };

// The account's last Discovery: every service it counts with the regions and
// versions it found, Supported services first, filtered from a sidebar on
// whether they are supported, whether they are among the account's
// Monitored services, `monitored`, and on the regions enabled in the
// account, and the parts it could not read, with a button to read only
// those again. `busy` is whether any Scan or Discovery of the account is
// running, which the button waits for. The top bar tells when it ran and
// runs it again.
//
// The page's URL keeps the chosen filters, replaced on each change rather
// than added to the history, so that going back to the page, reloading it
// or opening a link to it shows them as they were.
export function DiscoverySection({
  discovery,
  monitored,
  busy,
}: {
  discovery: DiscoveryResult;
  monitored?: SupportedService[];
  busy: boolean;
}) {
  const [filters, setFilters] = useUrlState(discoveryFiltersOf, discoverySearchParamsOf);
  const view = discoveryViewOf(discovery, filters, monitored);

  // Chooses `value` in the filter `filter`, or unchooses it.
  function toggle<K extends keyof DiscoveryFilters>(filter: K, value: DiscoveryFilters[K][number]) {
    setFilters((current) => toggledIn(current, filter, value));
  }

  return (
    <SidebarLayout
      sections={[SUPPORT_SECTION, MONITORING_SECTION, REGIONS_SECTION]}
      sidebar={
        <>
          <FiltersHeading
            description="Show only the services that match every filter. A filter with nothing chosen lets every service through."
            anyChosen={Object.values(filters).some((chosen) => chosen.length > 0)}
            onClear={() => setFilters(NO_DISCOVERY_FILTERS)}
          />
          <FilterCard
            section={SUPPORT_SECTION}
            count={view.chosenCounts.support}
            description={
              <>
                <span className="block">Supported: awol can monitor it.</span>
                <span className="block">Not supported: counted, but awol cannot monitor it yet.</span>
              </>
            }
          >
            <FilterValues values={SUPPORT} chosen={filters.support} onToggle={(value) => toggle("support", value)} />
          </FilterCard>
          <FilterCard section={MONITORING_SECTION} count={view.chosenCounts.monitoring}>
            <FilterValues values={MONITORING} chosen={filters.monitoring} onToggle={(value) => toggle("monitoring", value)} />
          </FilterCard>
          <RegionsCard
            regions={discovery.regions}
            chosen={filters.regions}
            count={view.chosenCounts.regions}
            onToggle={(region) => toggle("regions", region)}
          />
        </>
      }
    >
      {discovery.failedParts.length > 0 && <FailedParts parts={discovery.failedParts} busy={busy} />}
      <ServicesTable rows={view.services} />
    </SidebarLayout>
  );
}

// The services table's columns: each heading, and its share of the table's
// width until a column is resized.
const SERVICE_COLUMNS = [
  { heading: "Service", className: "w-1/5" },
  { heading: "Resources", className: "w-1/10" },
  { heading: "Regions", className: "w-3/10" },
  { heading: "Versions", className: "w-2/5" },
] as const;

const SERVICE_HEADINGS = SERVICE_COLUMNS.map(({ heading }) => heading);

// Services the Discovery counts, one row each, in columns as wide whatever
// their rows hold, until one is resized.
function ServicesTable({ rows }: { rows: DiscoveredServiceRow[] }) {
  const columns = useColumnWidths("discovery", SERVICE_HEADINGS);
  return (
    <div className={TABLE_AREA}>
      <Table
        ref={columns.ref}
        className={cn("table-fixed", columns.tableClassName)}
        style={columns.tableStyle}
        containerClassName={SCROLLING_TABLE}
      >
        <TableHeader className={STICKY_HEADER}>
          <TableRow>
            {SERVICE_COLUMNS.map(({ heading, className }) => (
              <TableHead key={heading} className={cn("relative", className)} style={columns.head(heading)}>
                {heading}
                {columns.resizer(heading)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={SERVICE_COLUMNS.length} className="text-muted-foreground">
                No service passes the filters.
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <ServiceRow key={row.service} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ServiceRow({ row }: { row: DiscoveredServiceRow }) {
  return (
    <TableRow className={row.count === 0 ? "text-muted-foreground" : undefined}>
      <TableCell className="align-top">{row.service}</TableCell>
      <TableCell className="align-top tabular-nums">{row.count === 0 ? "none" : row.count}</TableCell>
      <TableCell className="align-top">
        <ul>
          {row.regions.map(({ region, count, stale }) => (
            <li key={region} className="flex items-center gap-2">
              <span>
                {region} <span className="tabular-nums">({count})</span>
              </span>
              {stale !== undefined && (
                <Badge variant="secondary">
                  <History />
                  Stale since {formatTime(stale.lastReadAt)}
                </Badge>
              )}
            </li>
          ))}
          {row.notInRegions.length > 0 && (
            <li className="text-xs text-muted-foreground">Not in {row.notInRegions.join(", ")}</li>
          )}
        </ul>
      </TableCell>
      <TableCell className="align-top">
        <ul>
          {row.versions.map(({ product, version, count }) => (
            <li key={`${product} ${version}`}>
              {product} <span className="font-mono">{version ?? "no version"}</span>{" "}
              <span className="tabular-nums text-muted-foreground">({count})</span>
            </li>
          ))}
        </ul>
      </TableCell>
    </TableRow>
  );
}

// The parts of the last Discovery that could not be read: each Stale,
// showing its last successful read, or never read, showing nothing but its
// error, with a button to read only those again.
function FailedParts({ parts, busy }: { parts: FailedDiscoveryPart[]; busy: boolean }) {
  return (
    <Alert className="max-w-4xl">
      <History />
      <AlertTitle>Some parts of the last Discovery could not be read</AlertTitle>
      <AlertDescription>
        <RerunFailedPartsButton busy={busy} />
        <ul className="flex flex-col gap-2">
          {parts.map(({ part, error, lastReadAt }) => (
            <li key={partName(part)}>
              <p>
                <span className="font-medium text-foreground">{partName(part)}</span>{" "}
                {lastReadAt === undefined ? "never read." : `Stale, showing the last successful read on ${formatTime(lastReadAt)}.`}
              </p>
              <p className="font-mono text-xs">{error}</p>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

// The name of a part of a Discovery.
function partName(part: DiscoveryPart): string {
  if (part.kind === "regions") return "The account's regions:";
  if (part.kind === "presence") return `${part.awsService} resources in ${part.region}:`;
  return `${part.service} versions in ${part.region}:`;
}
