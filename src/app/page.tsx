import { FileWarning, History, Info } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ConfigError, FailedPart, LastScan, ScanPart, UnmonitoredService } from "../awol/page-model.ts";
import { type NextStep, nextStepOf } from "../awol/next-step.ts";
import { pageModel } from "./app-awol.ts";
import { formatTime } from "./format.ts";
import { LoginNeeded } from "./login-needed.tsx";
import { ScanTable } from "./scan-table.tsx";

export default async function DashboardPage() {
  await connection();
  const model = await pageModel();

  if (model.kind === "login-needed") return <LoginNeeded reason={model.reason} />;

  if (model.lastScan === undefined) return <NoScanYet next={nextStepOf(model)} />;
  return <ScanResult scan={model.lastScan} />;
}

// The dashboard of an account with no Scan yet, pointing to the step before
// its first one, `next`.
function NoScanYet({ next }: { next: NextStep }) {
  return (
    <p className="text-muted-foreground">
      No Scan yet.
      {next === "discover" && (
        <>
          {" "}
          Run a <DiscoveryLink>Discovery</DiscoveryLink> first, then choose Monitored services under Monitoring in the top bar.
        </>
      )}
      {next === "choose-monitored-services" && " Choose Monitored services under Monitoring in the top bar for a Scan to read."}
    </p>
  );
}

// A link to the Discovery page.
function DiscoveryLink({ children }: { children: string }) {
  return (
    <Link href="/discovery" className="font-medium text-foreground underline underline-offset-4">
      {children}
    </Link>
  );
}

function ScanResult({ scan }: { scan: LastScan }) {
  return (
    <ScanTable scan={scan}>
      {scan.configError !== undefined && <ConfigErrorAlert error={scan.configError} />}
      {scan.unmonitoredServices.length > 0 && <UnmonitoredServices services={scan.unmonitoredServices} />}
      {scan.failedParts.length > 0 && <FailedParts parts={scan.failedParts} />}
    </ScanTable>
  );
}

// The account's configuration file that is not one, so no Component has an
// Environment or Project, and the table offers neither to group by.
function ConfigErrorAlert({ error }: { error: ConfigError }) {
  return (
    <Alert variant="destructive" className="max-w-4xl">
      <FileWarning />
      <AlertTitle>The account's configuration file could not be read</AlertTitle>
      <AlertDescription>
        <p>
          <span className="font-mono">{error.path}</span>: {error.error}
        </p>
        <p>Until it is fixed, no Component has an Environment or Project, and the table cannot group by them.</p>
      </AlertDescription>
    </Alert>
  );
}

// The supported services the last Scan found resources of that are not
// monitored, which awol never adds on its own.
function UnmonitoredServices({ services }: { services: UnmonitoredService[] }) {
  return (
    <Alert className="max-w-4xl">
      <Info />
      <AlertTitle>The last Scan found resources of services you do not monitor</AlertTitle>
      <AlertDescription>
        <ul>
          {services.map(({ service, count }) => (
            <li key={service}>
              <span className="font-medium text-foreground">{service}</span>:{" "}
              <span className="tabular-nums">{count}</span> {count === 1 ? "resource" : "resources"}
            </li>
          ))}
        </ul>
        <p>Choose them under Monitoring in the top bar for a Scan to read them.</p>
      </AlertDescription>
    </Alert>
  );
}

// The parts of the last Scan that could not be read: each Stale, showing its
// last successful read, or never read, showing nothing but its error.
function FailedParts({ parts }: { parts: FailedPart[] }) {
  return (
    <Alert className="max-w-4xl">
      <History />
      <AlertTitle>Some parts of the last Scan could not be read</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-2">
          {parts.map(({ part, error, lastReadAt }) => (
            <li key={partName(part)}>
              <p>
                <span className="font-medium text-foreground">{partName(part)}</span>{" "}
                {lastReadAt === undefined
                  ? neverRead(part)
                  : `Stale, showing the last successful read on ${formatTime(lastReadAt)}.`}
              </p>
              <p className="font-mono text-xs">{error}</p>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

// The name of a part of a Scan.
function partName(part: ScanPart): string {
  if (part.kind === "regions") return "The account's regions:";
  if (part.kind === "service") return `${part.service} in ${part.region}:`;
  if (part.kind === "unmonitored") return `${part.service} resources not monitored in ${part.region}:`;
  if (part.kind === "tags") return `Tags in ${part.region}:`;
  return `endoflife.date's ${part.product}:`;
}

// What a part of a Scan never read successfully leaves on the dashboard.
function neverRead(part: ScanPart): string {
  if (part.kind === "regions") return "never read, so no region was read.";
  if (part.kind === "service") return "never read, so none of its Components are shown.";
  if (part.kind === "unmonitored") return "never read, so the services not monitored there are not noted.";
  if (part.kind === "tags") return "never read, so its Components have no Environment or Project from tags.";
  return "never read, so its Components are Untracked.";
}
