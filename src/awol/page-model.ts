import type { Status } from "./status.ts";

// One row of the dashboard's table: a Component, its Status, and the dates of
// its Release Cycle that exist. A Current Component with no End of life has
// none announced.
export type ComponentRow = {
  service: "RDS";
  product: string;
  region: string;
  identifier: string;
  version: string;
  releaseCycle?: string;
  status: Status;
  cycleReleaseDate?: string;
  activeSupportEnd?: string;
  endOfLife?: string;
  extendedSupportEnd?: string;
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
