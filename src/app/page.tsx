import { KeyRound, TriangleAlert } from "lucide-react";
import { connection } from "next/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ComponentDrift, ComponentRow, Drift, LastScan, SupportDates } from "../awol/page-model.ts";
import { STATUSES, type Status } from "../awol/status.ts";
import { appAwol } from "./app-awol.ts";
import { ScanButton } from "./scan-button.tsx";

export default async function DashboardPage() {
  await connection();
  const model = await appAwol().pageModel();

  if (model.kind === "login-needed") {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <KeyRound />
        <AlertTitle>Your AWS credentials have expired or need an SSO login</AlertTitle>
        <AlertDescription>
          <p>
            Log in again with the profile active in the shell that started awol, for example with{" "}
            <code>aws sso login</code>, then reload this page.
          </p>
          <p className="font-mono text-xs">{model.reason}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p>
          <span className="text-muted-foreground">AWS account</span>{" "}
          <span className="font-mono">{model.accountId}</span>
        </p>
        <p>
          <span className="text-muted-foreground">Last Scan</span>{" "}
          {model.lastScan === undefined ? "none yet" : formatTime(model.lastScan.ranAt)}
        </p>
        <ScanButton />
      </div>
      {model.lastScan !== undefined && <ScanResult scan={model.lastScan} />}
    </div>
  );
}

function ScanResult({ scan }: { scan: LastScan }) {
  return (
    <>
      <ul className="flex flex-wrap gap-3">
        {STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-2 rounded-lg border px-4 py-2">
            <span className="text-2xl font-semibold tabular-nums">{scan.counts[status]}</span>
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
          {scan.components.map((component) => (
            <TableRow key={`${component.service}/${component.region}/${component.identifier}`}>
              <TableCell>{component.service}</TableCell>
              <TableCell>{component.product}</TableCell>
              <TableCell>{component.region}</TableCell>
              <TableCell className="font-mono">{component.identifier}</TableCell>
              <TableCell className="font-mono">{component.version}</TableCell>
              <TableCell className="font-mono">{component.releaseCycle}</TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  <StatusBadge status={component.status} />
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
          ))}
        </TableBody>
      </Table>
    </>
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
