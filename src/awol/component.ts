import type { ReleaseCycle } from "../endoflife/release-cycles.ts";

// The AWS services awol reads Components from.
export type Service = "RDS" | "ElastiCache" | "OpenSearch" | "Lambda";

// A Product awol reads from AWS: its name, its endoflife.date product, the
// Release Cycle names a version could match, most specific first, and a
// version as endoflife.date numbers Latest patches. A Product whose dates
// mean something else on endoflife.date reads each Release Cycle with
// `readReleaseCycle`, and one whose Newest cycle is not the newest of all its
// Release Cycles gives the Newest cycle for a Component's Release Cycle with
// `newestCycle`.
export type Product = {
  name: string;
  endOfLifeProduct: string;
  cycleNames(version: string): string[];
  latestPatchVersion(version: string): string;
  readReleaseCycle?(cycle: ReleaseCycle): ReleaseCycle;
  newestCycle?(cycles: ReleaseCycle[], releaseCycle: ReleaseCycle): ReleaseCycle | undefined;
};

// The End of life and end of Extended Support one source gives, where it
// gives them.
export type SupportDates = {
  endOfLife?: string;
  extendedSupportEnd?: string;
};

// What AWS does with a Component at End of life: enroll it into Extended
// Support, or upgrade it.
export type ExtendedSupport = "Extended Support" | "auto-upgrade at End of life";

// One Component as a Scan read it from AWS, with its version, if it reports
// one, AWS's support dates for its AWS major version in its region, where AWS
// gives them, and the Newest offered version of its Product there, if AWS
// offers any.
export type ComponentReading = {
  service: Service;
  product: Product;
  region: string;
  identifier: string;
  version?: string;
  extendedSupport?: ExtendedSupport;
  awsLifecycle: SupportDates;
  newestOffered?: string;
};
