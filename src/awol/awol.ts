import { readOnly } from "../aws/read-only.ts";
import { AwsCliError, type AwsRunner } from "../aws/runner.ts";
import { openStore } from "../data/store.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import { openReleaseCycles } from "../endoflife/release-cycles.ts";
import { type Discovery, type DiscoveryScope, discoveryResultOf, runDiscovery } from "./discovery.ts";
import type { ComponentDrift, ComponentRow, DiscoveryResult, LastScan, PageModel, SupportDates } from "./page-model.ts";
import { componentsOf, failedPartsOf, runScan, type Scan } from "./scan.ts";
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

export type ScanOutcome = { kind: "scanned" } | LoginNeeded;

export type DiscoveryOutcome = { kind: "discovered" } | LoginNeeded;

// What to read in a Discovery, and what to tell the Discovery, as the
// dashboard would show it, each time it keeps a part.
export type DiscoverOptions = { scope?: DiscoveryScope; onPart?: (discovery: DiscoveryResult) => void };

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

  return {
    // Finds which services the account uses, region by region, keeping each
    // part as the account's last Discovery as soon as it is read and telling
    // `onPart`. With scope "failed", reads only the parts the last Discovery
    // could not read. Credentials that expire part-way leave the last
    // Discovery as it was.
    discover({ scope = "all", onPart }: DiscoverOptions = {}): Promise<DiscoveryOutcome> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
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
        return { kind: "discovered" } as const;
      });
    },

    // Reads every Component of the account and its lifecycle data, and keeps
    // them as the account's last Scan.
    scan(): Promise<ScanOutcome> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const { lastScan } = await store.account(accountId).load();
        const scan = await runScan(aws, releaseCycles, clock.now(), lastScan);
        await store.account(accountId).update((state) => ({ ...state, lastScan: scan }));
        return { kind: "scanned" } as const;
      });
    },

    // Credentials that have expired or need an SSO login make a page that
    // asks to log in again, with the CLI's reason.
    pageModel(): Promise<PageModel> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const { discovery, lastScan } = await store.account(accountId).load();
        return {
          kind: "signed-in",
          accountId,
          discovery: discovery === undefined ? undefined : discoveryResultOf(discovery),
          lastScan: lastScan === undefined ? undefined : lastScanOf(lastScan, clock.now()),
        } as const;
      });
    },
  };
}

// The last Scan as the dashboard shows it on `now`'s date: each Component's
// Status, sorted by Status and then by soonest End of life, and counted, and
// the parts that could not be read. Where AWS gives a date, it decides over
// endoflife.date's.
function lastScanOf(scan: Scan, now: Date): LastScan {
  const today = now.toISOString().slice(0, 10);
  const components = componentsOf(scan).map(({ releaseCycle, awsLifecycle: aws = {}, drift = NO_DRIFT, ...component }): ComponentRow => {
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
  return { ranAt: scan.ranAt, counts: countsOf(components), components, failedParts: failedPartsOf(scan) };
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
