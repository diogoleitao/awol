import type { Running } from "../data/run-lock.ts";
import type { ExtendedSupport, Service, SupportDates, SupportedService } from "./component.ts";
import type { DiscoveredServiceRow, DiscoveryPart, DiscoveryResult, FailedDiscoveryPart } from "./discovery.ts";
import type { Drift } from "./drift.ts";
import type { ComponentDrift, FailedPart, ScanPart, Stale, UnmonitoredService } from "./scan.ts";
import type { Status } from "./status.ts";

export type {
  ComponentDrift,
  DiscoveredServiceRow,
  DiscoveryPart,
  DiscoveryResult,
  Drift,
  FailedDiscoveryPart,
  FailedPart,
  Running,
  ScanPart,
  Stale,
  SupportDates,
  SupportedService,
  UnmonitoredService,
};

// Who started a Scan or Discovery, in words, as the dashboard and the
// server's log say it.
export function startedWhere({ startedBy }: Running): string {
  if (startedBy === "awol scan" || startedBy === "awol discover") return "started from the terminal";
  if (startedBy === "the server on start") return "started by the server";
  return "started from the dashboard";
}

// One row of the dashboard's table: a Component, its Status, and the dates of
// its Release Cycle that exist. End of life and the end of Extended Support
// are AWS's where AWS gives them and endoflife.date's otherwise, and decide
// Status; `sources` has each source's own, and `datesDisagree` marks a row
// where both give a date for the same thing and they differ. A Current
// Component with no End of life has none announced, and an Untracked one
// with no version reports none. `extendedSupport` is the Component's
// Extended Support setting, where AWS reports one. `drift` is how far its
// version is behind each Drift figure; it never decides Status. A Stale row
// comes from a part of the Scan that could not be read, and has the result of
// its last successful read, at `stale.lastReadAt`. `environment` and
// `project` are its Environment and Project, where it has them.
export type ComponentRow = {
  service: Service;
  product: string;
  region: string;
  identifier: string;
  environment?: string;
  project?: string;
  version?: string;
  extendedSupport?: ExtendedSupport;
  releaseCycle?: string;
  status: Status;
  cycleReleaseDate?: string;
  activeSupportEnd?: string;
  endOfLife?: string;
  extendedSupportEnd?: string;
  sources: { aws: SupportDates; "endoflife.date": SupportDates };
  datesDisagree: boolean;
  drift: ComponentDrift;
  stale?: Stale;
};

// The last Scan: when it ran, how many Components have each Status, its
// Components, most urgent first, the parts of it that could not be read, and
// the supported services it found resources of that are not monitored. An
// account whose configuration file is not one has `configError`, the file's
// path and why, and no Component with an Environment or Project.
export type LastScan = {
  ranAt: string;
  counts: Record<Status, number>;
  components: ComponentRow[];
  failedParts: FailedPart[];
  unmonitoredServices: UnmonitoredService[];
  configError?: ConfigError;
};

// An account's configuration file that is not one: its path, and why.
export type ConfigError = { path: string; error: string };

// What the dashboard shows: the AWS account of the active profile, its last
// Discovery, its Monitored services, once chosen, its last Scan, each if one
// has run, and the Scan or Discovery of it running now, in any awol process,
// if one is; or, when its credentials have expired or need an SSO login, the
// `aws` CLI's reason.
export type PageModel =
  | {
      kind: "signed-in";
      accountId: string;
      discovery?: DiscoveryResult;
      monitoredServices?: SupportedService[];
      lastScan?: LastScan;
      running?: Running;
    }
  | { kind: "login-needed"; reason: string };

// What the dashboard shows of an account whose credentials work.
export type SignedIn = Extract<PageModel, { kind: "signed-in" }>;
