import { History, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DiscoveredServiceRow, DiscoveryPart, DiscoveryResult, FailedDiscoveryPart } from "../awol/page-model.ts";
import { RerunFailedPartsButton } from "./discover-buttons.tsx";
import { formatTime } from "./format.ts";

// The account's last Discovery: every service it counts with the regions and
// versions it found, the services awol supports apart from the rest, and the
// parts it could not read, with a button to read only those again. `busy` is whether any Scan or Discovery of the account is
// running, which the button waits for. The top bar tells when it ran and
// runs it again.
export function DiscoverySection({ discovery, busy }: { discovery: DiscoveryResult; busy: boolean }) {
  const supported = discovery.services.filter(({ supported }) => supported);
  const unsupported = discovery.services.filter(({ supported }) => !supported);
  return (
    <section className="flex flex-col gap-6">
      {discovery.failedParts.length > 0 && <FailedParts parts={discovery.failedParts} busy={busy} />}
      <Tabs defaultValue="supported">
        <div className="flex items-center gap-2">
          <TabsList>
            <TabsTrigger value="supported">
              Supported <span className="tabular-nums text-muted-foreground">({supported.length})</span>
            </TabsTrigger>
            <TabsTrigger value="unsupported">
              Not supported <span className="tabular-nums text-muted-foreground">({unsupported.length})</span>
            </TabsTrigger>
          </TabsList>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="What Supported and Not supported mean" className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <Info className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <p>Supported: services awol can monitor. Choose them as Monitored services for a Scan to read their Components and lifecycle.</p>
              <p className="mt-1">Not supported: services Discovery counts so you know they are there, which awol cannot monitor yet.</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <TabsContent value="supported">
          <ServicesTable rows={supported} />
        </TabsContent>
        <TabsContent value="unsupported">
          <ServicesTable rows={unsupported} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

// Services the Discovery counts, one row each, in columns as wide in either
// tab whatever their rows hold.
function ServicesTable({ rows }: { rows: DiscoveredServiceRow[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/5">Service</TableHead>
          <TableHead className="w-1/10">Resources</TableHead>
          <TableHead className="w-3/10">Regions</TableHead>
          <TableHead className="w-2/5">Versions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <ServiceRow key={row.service} row={row} />
        ))}
      </TableBody>
    </Table>
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
