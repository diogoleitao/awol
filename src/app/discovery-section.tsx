import { History, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DiscoveredServiceRow, DiscoveryPart, DiscoveryResult, FailedDiscoveryPart } from "../awol/page-model.ts";
import { DiscoverButtons } from "./discover-buttons.tsx";
import { formatTime } from "./format.ts";

// The account's last Discovery: when it ran, every service it counts with
// the regions and versions it found, and the parts it could not read, with
// buttons to run it again. `running` is whether a Discovery is running now.
export function DiscoverySection({ discovery, running }: { discovery?: DiscoveryResult; running: boolean }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h2 className="font-semibold">Discovery</h2>
        <p>
          {running ? (
            <span className="flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" />
              Running since {formatTime(discovery?.startedAt ?? new Date().toISOString())}
            </span>
          ) : discovery === undefined ? (
            "none yet"
          ) : discovery.finishedAt === undefined ? (
            `Stopped part-way, started ${formatTime(discovery.startedAt)}`
          ) : (
            <>
              <span className="text-muted-foreground">Last run</span> {formatTime(discovery.finishedAt)}
            </>
          )}
        </p>
        <DiscoverButtons running={running} anyFailed={(discovery?.failedParts.length ?? 0) > 0} />
      </div>
      {discovery !== undefined && (
        <>
          {discovery.failedParts.length > 0 && <FailedParts parts={discovery.failedParts} />}
          <p className="text-sm text-muted-foreground">
            {discovery.regions.length} enabled {discovery.regions.length === 1 ? "region" : "regions"}
            {discovery.regions.length > 0 && `: ${discovery.regions.join(", ")}`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Resources</TableHead>
                <TableHead>Regions</TableHead>
                <TableHead>Versions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discovery.services.map((row) => (
                <ServiceRow key={row.service} row={row} />
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  );
}

function ServiceRow({ row }: { row: DiscoveredServiceRow }) {
  return (
    <TableRow className={row.count === 0 ? "text-muted-foreground" : undefined}>
      <TableCell className="align-top">
        <span className="flex items-center gap-2">
          {row.service}
          {!row.supported && <Badge variant="outline">not supported</Badge>}
        </span>
      </TableCell>
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
// error.
function FailedParts({ parts }: { parts: FailedDiscoveryPart[] }) {
  return (
    <Alert className="max-w-4xl">
      <History />
      <AlertTitle>Some parts of the last Discovery could not be read</AlertTitle>
      <AlertDescription>
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
