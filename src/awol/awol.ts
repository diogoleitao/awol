import { readOnly } from "../aws/read-only.ts";
import { AwsCliError, type AwsRunner } from "../aws/runner.ts";
import { openStore } from "../data/store.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import { openReleaseCycles } from "../endoflife/release-cycles.ts";
import type { ComponentRow, LastScan, PageModel, SupportDates } from "./page-model.ts";
import { runScan, type Scan } from "./scan.ts";
import { STATUSES, statusOf } from "./status.ts";

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
    // Reads every Component of the account and its lifecycle data, and keeps
    // them as the account's last Scan.
    scan(): Promise<ScanOutcome> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const scan = await runScan(aws, releaseCycles, clock.now());
        await store.account(accountId).update((state) => ({ ...state, lastScan: scan }));
        return { kind: "scanned" } as const;
      });
    },

    // Credentials that have expired or need an SSO login make a page that
    // asks to log in again, with the CLI's reason.
    pageModel(): Promise<PageModel> {
      return orLoginNeeded(async () => {
        const accountId = await identify();
        const { lastScan } = await store.account(accountId).load();
        return {
          kind: "signed-in",
          accountId,
          lastScan: lastScan === undefined ? undefined : lastScanOf(lastScan, clock.now()),
        } as const;
      });
    },
  };
}

// The last Scan as the dashboard shows it on `now`'s date: each Component's
// Status, sorted by Status and then by soonest End of life, and counted.
// Where AWS gives a date, it decides over endoflife.date's.
function lastScanOf(scan: Scan, now: Date): LastScan {
  const today = now.toISOString().slice(0, 10);
  const components = scan.components.map(({ releaseCycle, awsLifecycle: aws = {}, ...component }): ComponentRow => {
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
    };
  });
  components.sort(
    (a, b) =>
      STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
      compareSoonestFirst(a.endOfLife, b.endOfLife),
  );
  const counts = Object.fromEntries(
    STATUSES.map((status) => [status, components.filter((component) => component.status === status).length]),
  ) as LastScan["counts"];
  return { ranAt: scan.ranAt, counts, components };
}

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
