import Link from "next/link";
import { connection } from "next/server";
import type { Running } from "../awol/page-model.ts";
import { type LastRun, type TopBarItem, topBarOf } from "../awol/top-bar.ts";
import { discoveryRunning, pageModel } from "./app-awol.ts";
import { DiscoverButton } from "./discover-buttons.tsx";
import { formatClock, formatTime, startedWhere } from "./format.ts";
import { MonitoringButton } from "./monitoring-button.tsx";
import { RunItem } from "./run-item.tsx";
import { ScanButton } from "./scan-button.tsx";

// The bar atop every page: awol, the account's Discovery, a tab to its page,
// and Scan, each with its run button, the account's Monitored services, and
// the AWS account, or that credentials have expired or need an SSO login.
export async function TopBar() {
  await connection();
  const model = await pageModel();
  const bar = model.kind === "signed-in" ? topBarOf(model, discoveryRunning()) : undefined;
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-background px-8 py-3 sm:flex-nowrap lg:h-(--top-bar-height)">
      <div className="sm:flex-1">
        <Link href="/" className="font-semibold tracking-tight">
          awol
        </Link>
      </div>
      {model.kind === "signed-in" && bar !== undefined && (
        <nav className="order-last flex w-full justify-center gap-2 sm:order-none sm:w-auto">
          <RunItem
            label="Discovery"
            description="Finds which services the account uses, region by region."
            href="/discovery"
            {...stateOf(bar.discovery, "Discovery")}
          >
            <DiscoverButton disabled={bar.discovery.blocked !== undefined} running={bar.discovery.lastRun.kind === "running"} />
          </RunItem>
          <RunItem label="Scan" description="Reads the Components of the Monitored services and their lifecycle." {...stateOf(bar.scan, "Scan")}>
            <ScanButton disabled={bar.scan.blocked !== undefined} running={bar.scan.lastRun.kind === "running"} />
          </RunItem>
          <MonitoringButton
            services={model.discovery?.services.filter(({ supported }) => supported)}
            monitored={model.monitoredServices}
          />
        </nav>
      )}
      <p className="text-sm sm:flex-1 sm:text-right">
        {model.kind === "signed-in" ? (
          <>
            <span className="text-muted-foreground">AWS account</span> <span className="font-mono">{model.accountId}</span>
          </>
        ) : (
          <span className="text-destructive">Login needed</span>
        )}
      </p>
    </header>
  );
}

// What a top bar item shows of a Scan or Discovery, `operation`.
function stateOf(item: TopBarItem, operation: Running["operation"]) {
  const details = [lastRunOf(item.lastRun, operation)];
  if (item.failedParts > 0) details.push(`${item.failedParts} ${item.failedParts === 1 ? "part" : "parts"} could not be read`);
  if (item.blocked === "no-monitored-services") details.push("Choose Monitored services under Monitoring in the top bar first");
  return { warning: item.warning, details };
}

// A Scan or Discovery's last run, in words.
function lastRunOf(lastRun: LastRun, operation: Running["operation"]): string {
  if (lastRun.kind === "none-yet") return `No ${operation} yet`;
  if (lastRun.kind === "ran") return `Last run ${formatTime(lastRun.at)}`;
  if (lastRun.kind === "stopped-part-way") return `Stopped part-way, started ${formatTime(lastRun.startedAt)}`;
  // A Discovery this server has started is running before it holds the
  // account's lock, which says who started it and when.
  if (lastRun.run === undefined) return "Starting";
  return `Running since ${formatClock(lastRun.run.startedAt)}, ${startedWhere(lastRun.run)}`;
}
