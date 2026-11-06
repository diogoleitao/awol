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
  ScanPart,
  Stale,
  SupportDates,
  SupportedService,
  UnmonitoredService,
};

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
// its last successful read, at `stale.lastReadAt`.
export type ComponentRow = {
  service: Service;
  product: string;
  region: string;
  identifier: string;
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
// the supported services it found resources of that are not monitored.
export type LastScan = {
  ranAt: string;
  counts: Record<Status, number>;
  components: ComponentRow[];
  failedParts: FailedPart[];
  unmonitoredServices: UnmonitoredService[];
};

// What the dashboard shows: the AWS account of the active profile, its last
// Discovery, its Monitored services, once chosen, and its last Scan, each if
// one has run, or, when its credentials have expired or need an SSO login,
// the `aws` CLI's reason.
export type PageModel =
  | {
      kind: "signed-in";
      accountId: string;
      discovery?: DiscoveryResult;
      monitoredServices?: SupportedService[];
      lastScan?: LastScan;
    }
  | { kind: "login-needed"; reason: string };
