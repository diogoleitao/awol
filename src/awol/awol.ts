import { readOnly } from "../aws/read-only.ts";
import { AwsCliError, type AwsRunner } from "../aws/runner.ts";
import { type LoadedConfig, openConfig, readsTags } from "../data/config.ts";
import { Cancelled as CancelledError, type Running, type Starter } from "../data/run-lock.ts";
import { openStore } from "../data/store.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import { openReleaseCycles } from "../endoflife/release-cycles.ts";
import { environmentAndProjectOf, withCommonSpellings } from "./account-config.ts";
import { SUPPORTED_SERVICES, type SupportedService } from "./component.ts";
import { countSupportedIn, type Discovery, type DiscoveryScope, discoveryResultOf, runDiscovery } from "./discovery.ts";
import type { ComponentDrift, ComponentRow, DiscoveryResult, LastScan, PageModel, SupportDates } from "./page-model.ts";
import type { Part, Progress, Step } from "./progress.ts";
import { componentsOf, failedPartsOf, runScan, type Scan, unmonitoredServicesOf } from "./scan.ts";
import { countsOf, STATUSES, statusOf } from "./status.ts";

export type { Part, Progress, Step };

export type Clock = { now(): Date };

export type AwolOptions = {
  aws: AwsRunner;
  // Where Scans read Release Cycles from.
  endOfLife: EndOfLifeFetcher;
  dataDir: string;
  // Where each account's configuration file is.
  configDir: string;
  clock: Clock;
};

// What an operation that reads AWS ends in, when credentials have expired or
// need an SSO login: the `aws` CLI's reason.
type LoginNeeded = { kind: "login-needed"; reason: string };

// What a Scan or Discovery ends in when another of the same account is
// running: the account, the one running, and the process running it.
export type Busy = { kind: "busy"; accountId: string; running: Running; pid: number };

// What a Scan or Discovery ends in when it is cancelled on request part-way,
// leaving the last one as it was.
type Cancelled = { kind: "cancelled" };

// What a Scan ends in: read, as the dashboard then shows the last Scan, not
// read because no Monitored services have been chosen yet or another Scan
// or Discovery is running, cancelled, or the CLI's reason to log in again.
export type ScanOutcome = { kind: "scanned"; lastScan: LastScan } | { kind: "monitored-services-needed" } | Busy | Cancelled | LoginNeeded;

// What a Discovery ends in: read, as the dashboard then shows it, not read
// because another Scan or Discovery is running, cancelled, or the CLI's
// reason to log in again.
export type DiscoveryOutcome = { kind: "discovered"; discovery: DiscoveryResult } | Busy | Cancelled | LoginNeeded;

// What choosing Monitored services ends in: kept, or the CLI's reason to log
// in again, leaving them as they were.
export type SetMonitoredServicesOutcome = { kind: "saved" } | LoginNeeded;

// What to read in a Discovery, what to tell the Discovery, as the dashboard
// would show it, each time it keeps a part, what to tell of its progress,
// what started it, the dashboard unless given, and the process whose
// account lock to take over, known not to run a Scan or Discovery any more.
export type DiscoverOptions = {
  scope?: DiscoveryScope;
  onPart?: (discovery: DiscoveryResult) => void;
  onProgress?: (progress: Progress) => void;
  startedBy?: Starter;
  takeOver?: number;
};

// What to tell of a Scan's progress, whether to read every supported
// service, instead of nothing, while no Monitored services are chosen, what
// started it, the dashboard unless given, and the process whose account lock
// to take over, known not to run a Scan or Discovery any more.
export type ScanOptions = {
  onProgress?: (progress: Progress) => void;
  readEverySupportedService?: boolean;
  startedBy?: Starter;
  takeOver?: number;
};

// What to tell the Discovery awol starts with, if it starts with one: that
// it starts, and each part it keeps.
export type StartOptions = { onDiscovery?: () => void; onPart?: (discovery: DiscoveryResult) => void };

// awol on one data directory, reading AWS and endoflife.date: what the
// dashboard and the CLI both run.
export type Awol = ReturnType<typeof openAwol>;

export function openAwol({ aws: runner, endOfLife, dataDir, configDir, clock }: AwolOptions) {
  // Every AWS call awol makes goes through here (ADR 0002).
  const aws = readOnly(runner);
  const store = openStore(dataDir);
  const config = openConfig(configDir);
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

  // Runs `run`, a Scan or Discovery of the account `accountId` started by
  // `startedBy`, holding the account's lock, unless another is running, one
  // held by `takeOver` aside. `run` checks with `stopIfCancelled` before each
  // part whether it has been asked to stop.
  async function exclusively<T>(
    accountId: string,
    operation: Running["operation"],
    { startedBy, takeOver }: { startedBy: Starter; takeOver?: number },
    run: (stopIfCancelled: () => Promise<void>) => Promise<T>,
  ): Promise<T | Busy | Cancelled> {
    const taken = await store.account(accountId).lock.take({ operation, startedBy, startedAt: clock.now().toISOString() }, takeOver);
    if (taken.kind === "busy") return { kind: "busy", accountId, running: taken.running, pid: taken.pid };
    try {
      return await run(taken.stopIfCancelled);
    } catch (error) {
      if (error instanceof CancelledError) return { kind: "cancelled" };
      throw error;
    } finally {
      await taken.release();
    }
  }

  // Runs a Discovery of the account `accountId`, as `discover` does, once
  // it holds the account's lock.
  async function discoverAccount(
    accountId: string,
    { scope = "all", onPart, onProgress }: DiscoverOptions,
    stopIfCancelled: () => Promise<void>,
  ): Promise<DiscoveryOutcome & { kind: "discovered" }> {
    const account = store.account(accountId);
    const { discovery: previous } = await account.load();
    const save = (discovery: Discovery | undefined) => account.update((state) => ({ ...state, discovery }));
    let last = previous;
    try {
      await runDiscovery(
        aws,
        () => clock.now(),
        previous,
        scope,
        async (discovery) => {
          last = discovery;
          await save(discovery);
          onPart?.(discoveryResultOf(discovery));
        },
        onProgress,
        stopIfCancelled,
      );
    } catch (error) {
      await save(previous);
      throw error;
    }
    return { kind: "discovered", discovery: discoveryResultOf(last!) };
  }

  // Runs a Scan of the account `accountId`, as `scan` does.
  async function scanAccount(
    accountId: string,
    { onProgress, readEverySupportedService, startedBy = "the dashboard", takeOver }: ScanOptions = {},
  ): Promise<ScanOutcome> {
    const { monitoredServices } = await store.account(accountId).load();
    if (monitoredServices === undefined && !readEverySupportedService) return { kind: "monitored-services-needed" };
    const monitored = monitoredServices ?? [...SUPPORTED_SERVICES];
    return exclusively(accountId, "Scan", { startedBy, takeOver }, async (stopIfCancelled) => {
      // Read once the lock is held, so no Scan that ended meanwhile is lost.
      const { lastScan } = await store.account(accountId).load();
      const loaded = await config.account(accountId);
      const scan = await runScan(aws, releaseCycles, countSupportedIn, clock.now(), lastScan, monitored, readsTags(loaded), onProgress, stopIfCancelled);
      await store.account(accountId).update((state) => ({ ...state, lastScan: scan }));
      return { kind: "scanned", lastScan: lastScanOf(scan, monitored, clock.now(), loaded) } as const;
    });
  }

  return {
    // What awol does when it starts: a Discovery of an account it has never
    // discovered, telling `onDiscovery` first, or else a Scan, unless another
    // Scan or Discovery of the account is running.
    start({ onDiscovery, onPart }: StartOptions = {}): Promise<DiscoveryOutcome | ScanOutcome> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const { discovery } = await store.account(accountId).load();
        if (discovery !== undefined) return scanAccount(accountId, { startedBy: "the server on start" });
        return exclusively(accountId, "Discovery", { startedBy: "the server on start" }, (stopIfCancelled) => {
          onDiscovery?.();
          return discoverAccount(accountId, { onPart }, stopIfCancelled);
        });
      });
    },

    // Finds which services the account uses, region by region, keeping each
    // part as the account's last Discovery as soon as it is read and telling
    // `onPart`. With scope "failed", reads only the parts the last Discovery
    // could not read. Credentials that expire part-way leave the last
    // Discovery as it was. Nothing is read while another Scan or Discovery
    // of the account is running.
    discover(options: DiscoverOptions = {}): Promise<DiscoveryOutcome> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const { startedBy = "the dashboard", takeOver } = options;
        return exclusively(accountId, "Discovery", { startedBy, takeOver }, (stopIfCancelled) =>
          discoverAccount(accountId, options, stopIfCancelled),
        );
      });
    },

    // Asks the Scan or Discovery `busy` names to stop at its next part, and
    // waits up to `timeoutMs` for it to free the account. Gives whether it
    // did. A cancelled Scan or Discovery leaves the last one as it was.
    cancel({ accountId, running, pid }: Busy, timeoutMs: number): Promise<boolean> {
      return store.account(accountId).lock.cancel(pid, running, timeoutMs);
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
    // Monitored services are chosen it reads nothing, or, when asked to,
    // every supported service, leaving them unchosen. Nothing is read while
    // another Scan or Discovery of the account is running. Its progress is
    // told to `onProgress`.
    scan(options: ScanOptions = {}): Promise<ScanOutcome> {
      return orLoginNeeded(async () => scanAccount(await identify(), options));
    },

    // Credentials that have expired or need an SSO login make a page that
    // asks to log in again, with the CLI's reason.
    pageModel(): Promise<PageModel> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const account = store.account(accountId);
        const { discovery, monitoredServices, lastScan } = await account.load();
        return {
          kind: "signed-in",
          accountId,
          discovery: discovery === undefined ? undefined : discoveryResultOf(discovery),
          monitoredServices,
          // A Scan with no Monitored services chosen read every supported
          // service: one asked to, or one from before awol had them. The
          // configuration is read on each page, so a change to it shows
          // without a Scan.
          lastScan:
            lastScan === undefined
              ? undefined
              : lastScanOf(lastScan, monitoredServices ?? [...SUPPORTED_SERVICES], clock.now(), await config.account(accountId)),
          running: await account.lock.running(),
        } as const;
      });
    },
  };
}

// The last Scan as the dashboard shows it on `now`'s date: each Component's
// Status, sorted by Status and then by soonest End of life, and counted, the
// parts that could not be read, and the supported services it found
// resources of that are not `monitored`, each Component with its
// Environment and Project as `loaded` reads them. Where AWS gives a date,
// it decides over endoflife.date's.
function lastScanOf(scan: Scan, monitored: SupportedService[], now: Date, loaded: LoadedConfig): LastScan {
  const today = now.toISOString().slice(0, 10);
  const components = componentsOf(scan, monitored).map(({ releaseCycle, awsLifecycle: aws = {}, drift = NO_DRIFT, tags, ...component }): ComponentRow => {
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
      ...(loaded.kind === "loaded" ? environmentAndProjectOf(loaded.config, component, tags) : {}),
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
    components: withCommonSpellings(components),
    failedParts: failedPartsOf(scan),
    unmonitoredServices: unmonitoredServicesOf(scan, monitored),
    ...(loaded.kind === "invalid" ? { configError: { path: loaded.path, error: loaded.error } } : {}),
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
