import { History, KeyRound } from "lucide-react";
import { connection } from "next/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { FailedPart, LastScan, ScanPart } from "../awol/page-model.ts";
import { appAwol, discoveryRunning } from "./app-awol.ts";
import { DiscoverySection } from "./discovery-section.tsx";
import { formatTime } from "./format.ts";
import { ScanButton } from "./scan-button.tsx";
import { ScanTable } from "./scan-table.tsx";

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
      <DiscoverySection discovery={model.discovery} running={discoveryRunning()} />
      {model.lastScan !== undefined && <ScanResult scan={model.lastScan} />}
    </div>
  );
}

function ScanResult({ scan }: { scan: LastScan }) {
  return (
    <>
      {scan.failedParts.length > 0 && <FailedParts parts={scan.failedParts} />}
      <ScanTable scan={scan} />
    </>
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
  return `endoflife.date's ${part.product}:`;
}

// What a part of a Scan never read successfully leaves on the dashboard.
function neverRead(part: ScanPart): string {
  if (part.kind === "regions") return "never read, so no region was read.";
  if (part.kind === "service") return "never read, so none of its Components are shown.";
  return "never read, so its Components are Untracked.";
}
