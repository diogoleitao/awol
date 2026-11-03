import type { ExtendedSupport, SupportDates } from "./rds.ts";
import type { Status } from "./status.ts";

export type { SupportDates };

// One row of the dashboard's table: a Component, its Status, and the dates of
// its Release Cycle that exist. End of life and the end of Extended Support
// are AWS's where AWS gives them and endoflife.date's otherwise, and decide
// Status; `sources` has each source's own, and `datesDisagree` marks a row
// where both give a date for the same thing and they differ. A Current
// Component with no End of life has none announced. `extendedSupport` is the
// Component's Extended Support setting, where AWS reports one.
export type ComponentRow = {
  service: "RDS";
  product: string;
  region: string;
  identifier: string;
  version: string;
  extendedSupport?: ExtendedSupport;
  releaseCycle?: string;
  status: Status;
  cycleReleaseDate?: string;
  activeSupportEnd?: string;
  endOfLife?: string;
  extendedSupportEnd?: string;
  sources: { aws: SupportDates; "endoflife.date": SupportDates };
  datesDisagree: boolean;
};

// The last Scan: when it ran, how many Components have each Status, and its
// Components, most urgent first.
export type LastScan = {
  ranAt: string;
  counts: Record<Status, number>;
  components: ComponentRow[];
};

// What the dashboard shows: the AWS account of the active profile and its
// last Scan, if one has run, or, when its credentials have expired or need an
// SSO login, the `aws` CLI's reason.
export type PageModel =
  | { kind: "signed-in"; accountId: string; lastScan?: LastScan }
  | { kind: "login-needed"; reason: string };
