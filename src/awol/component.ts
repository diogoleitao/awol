import type { ReleaseCycle } from "../endoflife/release-cycles.ts";

// The AWS services awol reads Components from.
export type Service = "RDS" | "ElastiCache" | "OpenSearch" | "Lambda";

// The services awol can monitor, in the order the dashboard shows them, any
// of which can be a Monitored service.
export const SUPPORTED_SERVICES = ["RDS", "Aurora", "ElastiCache Redis OSS", "OpenSearch Service", "Lambda"] as const;

// A service awol can monitor.
export type SupportedService = (typeof SUPPORTED_SERVICES)[number];

// A resource's tags, by key.
export type Tags = Record<string, string>;

// The name of the resource the Component `identifier` of `service` is: for
// Lambda, its function's, which has no colon and comes before the version,
// and for every other service, the identifier itself.
export function resourceNameOf(service: Service, identifier: string): string {
  return service === "Lambda" ? identifier.split(":")[0]! : identifier;
}

// How many resources of each of some supported services there are.
export type SupportedCounts = Partial<Record<SupportedService, number>>;

// The supported services of each AWS service a Scan reads.
export const SUPPORTED_BY: Record<Service, SupportedService[]> = {
  RDS: ["RDS", "Aurora"],
  ElastiCache: ["ElastiCache Redis OSS"],
  OpenSearch: ["OpenSearch Service"],
  Lambda: ["Lambda"],
};

// The supported service a Component of `product`, read from AWS service
// `service`, is of: Aurora clusters are Aurora's, and every other RDS
// Component is RDS's.
export function supportedServiceOf(service: Service, product: string): SupportedService {
  return service === "RDS" && product.startsWith("amazon-aurora-") ? "Aurora" : SUPPORTED_BY[service][0]!;
}

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

// One Component as AWS reports it, with its version, if it reports one.
export type ComponentVersion = {
  service: Service;
  product: Product;
  region: string;
  identifier: string;
  version?: string;
};

// One Component as a Scan read it from AWS, with its version, AWS's support
// dates for its AWS major version in its region, where AWS gives them, and
// the Newest offered version of its Product there, if AWS offers any.
export type ComponentReading = ComponentVersion & {
  extendedSupport?: ExtendedSupport;
  awsLifecycle: SupportDates;
  newestOffered?: string;
};
