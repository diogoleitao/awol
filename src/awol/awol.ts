import { readOnly } from "../aws/read-only.ts";
import { AwsCliError, type AwsRunner } from "../aws/runner.ts";
import { openStore } from "../data/store.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import { openReleaseCycles } from "../endoflife/release-cycles.ts";
import { SUPPORTED_SERVICES, type SupportedService } from "./component.ts";
import { countSupportedIn, type Discovery, type DiscoveryScope, discoveryResultOf, runDiscovery } from "./discovery.ts";
import type { ComponentDrift, ComponentRow, DiscoveryResult, LastScan, PageModel, SupportDates } from "./page-model.ts";
import { componentsOf, failedPartsOf, runScan, type Scan, unmonitoredServicesOf } from "./scan.ts";
import { countsOf, STATUSES, statusOf } from "./status.ts";

export type Clock = { now(): Date };

export type AwolOptions = {
  aws: AwsRunner;
  // Where Scans read Release Cycles from.
  endOfLife: EndOfLifeFetcher;
  dataDir: string;
  clock: Clock;
};

// What an operation that reads AWS ends in, when credentials have expired or
// need an SSO login: the `aws` CLI's reason.
type LoginNeeded = { kind: "login-needed"; reason: string };

// What a Scan ends in: read, not read because no Monitored services have been
// chosen yet, or the CLI's reason to log in again.
export type ScanOutcome = { kind: "scanned" } | { kind: "monitored-services-needed" } | LoginNeeded;

export type DiscoveryOutcome = { kind: "discovered" } | LoginNeeded;

// What choosing Monitored services ends in: kept, or the CLI's reason to log
// in again, leaving them as they were.
export type SetMonitoredServicesOutcome = { kind: "saved" } | LoginNeeded;

// What to read in a Discovery, and what to tell the Discovery, as the
// dashboard would show it, each time it keeps a part.
export type DiscoverOptions = { scope?: DiscoveryScope; onPart?: (discovery: DiscoveryResult) => void };

// What to tell the Discovery awol starts with, if it starts with one: that
// it starts, and each part it keeps.
export type StartOptions = { onDiscovery?: () => void; onPart?: (discovery: DiscoveryResult) => void };

export function openAwol({ aws: runner, endOfLife, dataDir, clock }: AwolOptions) {
  // Every AWS call awol makes goes through here (ADR 0002).
  const aws = readOnly(runner);
  const store = openStore(dataDir);
  const releaseCycles = openReleaseCycles(endOfLife, dataDir);

  // The ID of the AWS account behind the active profile, recorded as seen
  // now.
  async function identify(): Promise<string> {
    const stdout = await aws(["sts", "get-caller-identity", "--output", "json"]);
    const accountId = (JSON.parse(stdout) as { Account: string }).Account;
    const seenAt = clock.now().toISOString();
    await store.account(accountId).update((state) => ({
      ...state,
      firstSeenAt: state.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
    }));
    return accountId;
  }

  // Runs `operation`, turning credentials that have expired or need an SSO
  // login into the CLI's reason.
  async function orLoginNeeded<T>(operation: () => Promise<T>): Promise<T | LoginNeeded> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AwsCliError && error.kind === "expired-credentials") {
        return { kind: "login-needed", reason: error.message };
      }
      throw error;
    }
  }

  // Runs a Discovery of the account `accountId`, as `discover` does.
  async function discoverAccount(accountId: string, { scope = "all", onPart }: DiscoverOptions): Promise<{ kind: "discovered" }> {
    const account = store.account(accountId);
    const { discovery: previous } = await account.load();
    const save = (discovery: Discovery | undefined) => account.update((state) => ({ ...state, discovery }));
    try {
      await runDiscovery(aws, () => clock.now(), previous, scope, async (discovery) => {
        await save(discovery);
        onPart?.(discoveryResultOf(discovery));
      });
    } catch (error) {
      await save(previous);
      throw error;
    }
    return { kind: "discovered" };
  }

  // Runs a Scan of the account `accountId`, as `scan` does.
  async function scanAccount(accountId: string): Promise<ScanOutcome> {
    const { monitoredServices, lastScan } = await store.account(accountId).load();
    if (monitoredServices === undefined) return { kind: "monitored-services-needed" };
    const scan = await runScan(aws, releaseCycles, countSupportedIn, clock.now(), lastScan, monitoredServices);
    await store.account(accountId).update((state) => ({ ...state, lastScan: scan }));
    return { kind: "scanned" };
  }

  return {
    // What awol does when it starts: a Discovery of an account it has never
    // discovered, telling `onDiscovery` first, or else a Scan.
    start({ onDiscovery, onPart }: StartOptions = {}): Promise<DiscoveryOutcome | ScanOutcome> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const { discovery } = await store.account(accountId).load();
        if (discovery !== undefined) return scanAccount(accountId);
        onDiscovery?.();
        return discoverAccount(accountId, { onPart });
      });
    },

    // Finds which services the account uses, region by region, keeping each
    // part as the account's last Discovery as soon as it is read and telling
    // `onPart`. With scope "failed", reads only the parts the last Discovery
    // could not read. Credentials that expire part-way leave the last
    // Discovery as it was.
    discover(options: DiscoverOptions = {}): Promise<DiscoveryOutcome> {
      return orLoginNeeded(async () => discoverAccount(await identify(), options));
    },

    // Keeps `services` as the account's Monitored services, in the order the
    // dashboard shows them.
    setMonitoredServices(services: SupportedService[]): Promise<SetMonitoredServicesOutcome> {
      return orLoginNeeded(async () => {
        const monitoredServices = SUPPORTED_SERVICES.filter((service) => services.includes(service));
        await store.account(await identify()).update((state) => ({ ...state, monitoredServices }));
        return { kind: "saved" } as const;
      });
    },

    // Reads every Component of the account's Monitored services and its
    // lifecycle data, and keeps them as the account's last Scan. Before any
    // Monitored services are chosen it reads nothing.
    scan(): Promise<ScanOutcome> {
      return orLoginNeeded(async () => scanAccount(await identify()));
    },

    // Credentials that have expired or need an SSO login make a page that
    // asks to log in again, with the CLI's reason.
    pageModel(): Promise<PageModel> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const { discovery, monitoredServices, lastScan } = await store.account(accountId).load();
        return {
          kind: "signed-in",
          accountId,
          discovery: discovery === undefined ? undefined : discoveryResultOf(discovery),
          monitoredServices,
          // A Scan needs Monitored services, so one with none chosen is
          // from before awol had them, and read every service.
          lastScan: lastScan === undefined ? undefined : lastScanOf(lastScan, monitoredServices ?? [...SUPPORTED_SERVICES], clock.now()),
        } as const;
      });
    },
  };
}

// The last Scan as the dashboard shows it on `now`'s date: each Component's
// Status, sorted by Status and then by soonest End of life, and counted, the
// parts that could not be read, and the supported services it found
// resources of that are not `monitored`. Where AWS gives a date, it decides
// over endoflife.date's.
function lastScanOf(scan: Scan, monitored: SupportedService[], now: Date): LastScan {
  const today = now.toISOString().slice(0, 10);
  const components = componentsOf(scan, monitored).map(({ releaseCycle, awsLifecycle: aws = {}, drift = NO_DRIFT, ...component }): ComponentRow => {
    const fromEndOfLifeDate: SupportDates = {
      endOfLife: releaseCycle?.endOfLife,
      extendedSupportEnd: releaseCycle?.extendedSupportEnd,
    };
    const deciding = releaseCycle && {
      ...releaseCycle,
      endOfLife: aws.endOfLife ?? fromEndOfLifeDate.endOfLife,
      extendedSupportEnd: aws.extendedSupportEnd ?? fromEndOfLifeDate.extendedSupportEnd,
    };
    return {
      ...component,
      releaseCycle: deciding?.name,
      status: statusOf(deciding, today),
      cycleReleaseDate: deciding?.releaseDate,
      activeSupportEnd: deciding?.activeSupportEnd,
      endOfLife: deciding?.endOfLife,
      extendedSupportEnd: deciding?.extendedSupportEnd,
      sources: { aws, "endoflife.date": fromEndOfLifeDate },
      datesDisagree: disagree(aws, fromEndOfLifeDate),
      drift,
    };
  });
  components.sort(
    (a, b) =>
      STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
      compareSoonestFirst(a.endOfLife, b.endOfLife),
  );
  return {
    ranAt: scan.ranAt,
    counts: countsOf(components),
    components,
    failedParts: failedPartsOf(scan),
    unmonitoredServices: unmonitoredServicesOf(scan, monitored),
  };
}

// The Drift of a Component in a Scan from before awol read Drift.
const NO_DRIFT: ComponentDrift = {
  latestPatch: { kind: "not-available" },
  newestCycle: { kind: "not-available" },
  newestOffered: { kind: "not-available" },
};

// Whether two sources both give a date for the same thing and the dates
// differ.
function disagree(a: SupportDates, b: SupportDates): boolean {
  const differ = (x: string | undefined, y: string | undefined) => x !== undefined && y !== undefined && x !== y;
  return differ(a.endOfLife, b.endOfLife) || differ(a.extendedSupportEnd, b.extendedSupportEnd);
}

// Dates in order, with no date last.
function compareSoonestFirst(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}
