import { AwsCliError, type AwsRunner } from "../aws/runner.ts";
import type { ReleaseCycle } from "../endoflife/release-cycles.ts";
import { failedRead, type PartRead, resultOf, staleSince } from "../part-read.ts";
import type { ComponentReading, ExtendedSupport, Product, Service, SupportDates } from "./component.ts";
import { type Drift, driftFrom, driftFromCycle, newestCycleOf, withHighestLatestPatch } from "./drift.ts";
import { ELASTICACHE_PRODUCTS, readElastiCacheComponents } from "./elasticache.ts";
import { LAMBDA_PRODUCT, readLambdaComponents } from "./lambda.ts";
import { OPENSEARCH_PRODUCTS, readOpenSearchComponents } from "./opensearch.ts";
import { RDS_PRODUCTS, readRdsComponents } from "./rds.ts";

// How many regions a Scan or Discovery reads at once.
export const REGION_CONCURRENCY = 8;

// The services a Scan reads in each region, in the order it reads them.
const SERVICES: [Service, (aws: AwsRunner, region: string) => Promise<ComponentReading[]>][] = [
  ["RDS", readRdsComponents],
  ["ElastiCache", readElastiCacheComponents],
  ["OpenSearch", readOpenSearchComponents],
  ["Lambda", readLambdaComponents],
];

// Every Product awol reads, by its endoflife.date product.
const PRODUCTS = new Map(
  [...RDS_PRODUCTS, ...ELASTICACHE_PRODUCTS, ...OPENSEARCH_PRODUCTS, LAMBDA_PRODUCT].map((product) => [product.endOfLifeProduct, product]),
);

// The Drift a Scan found for one Component.
export type ComponentDrift = { latestPatch: Drift; newestCycle: Drift; newestOffered: Drift };

// When a Stale Component, or a Stale part of a Scan, was last read
// successfully.
export type Stale = { lastReadAt: string };

// One Component as a Scan found it: what AWS reported, AWS's support dates
// for its AWS major version, the Release Cycle its version matched, if any,
// and its Drift. A Scan from before awol read AWS's dates and settings has
// none, and one from before it read Drift has no Drift. A Stale Component
// comes from parts of the Scan that could not be read, and is Stale since the
// older of their last successful reads.
export type ScannedComponent = {
  service: Service;
  product: string;
  region: string;
  identifier: string;
  version?: string;
  extendedSupport?: ExtendedSupport;
  awsLifecycle?: SupportDates;
  releaseCycle?: ReleaseCycle;
  drift?: ComponentDrift;
  stale?: Stale;
};

// One Component as AWS reported it, its Product given by its endoflife.date
// product, so it can be stored.
type StoredReading = Omit<ComponentReading, "product"> & { product: string };

// The Components of one service in one region.
type ServicePart = { service: Service; region: string } & PartRead<StoredReading[]>;

// The Release Cycles of one endoflife.date product, as endoflife.date gives
// them.
type ProductPart = { endOfLifeProduct: string } & PartRead<ReleaseCycle[]>;

// A Scan, kept by part: the regions enabled for the account, the Components
// of each service in each of them, and the Release Cycles of their Products.
// A Scan from before awol kept it by part has its Components only.
export type Scan = {
  ranAt: string;
  regions?: PartRead<string[]>;
  services?: ServicePart[];
  products?: ProductPart[];
  components?: ScannedComponent[];
};

// A part of a Scan, as the dashboard names it.
export type ScanPart =
  | { kind: "regions" }
  | { kind: "service"; service: Service; region: string }
  | { kind: "endoflife.date"; product: string };

// A part of the last Scan that could not be read, with its error: Stale with
// when it was last read successfully, or never read successfully.
export type FailedPart = { part: ScanPart; error: string } & Partial<Stale>;

// Reads every Component in the regions enabled for the account, and the
// Release Cycles of their Products. The account's regions, or a service in a
// region, that cannot be read keep their result from `previous`, the
// account's last Scan; a product endoflife.date fails for keeps its last
// answer.
export async function runScan(
  aws: AwsRunner,
  releaseCycles: (endOfLifeProduct: string, now: Date) => Promise<PartRead<ReleaseCycle[]>>,
  now: Date,
  previous: Scan | undefined,
): Promise<Scan> {
  const readAt = now.toISOString();
  const regions = await readPart(() => enabledRegions(aws), readAt, previous?.regions);
  const services = (
    await mapConcurrently(resultOf(regions) ?? [], REGION_CONCURRENCY, async (region) => {
      const parts: ServicePart[] = [];
      // One service at a time, so a region makes one call at once.
      for (const [service, read] of SERVICES) {
        const last = previous?.services?.find((part) => part.service === service && part.region === region);
        const reading = await readPart(async () => (await read(aws, region)).map(storedReading), readAt, last);
        parts.push({ service, region, ...reading });
      }
      return parts;
    })
  ).flat();

  const endOfLifeProducts = new Set(services.flatMap((part) => (resultOf(part) ?? []).map(({ product }) => product)));
  const products = await Promise.all(
    [...endOfLifeProducts].map(async (endOfLifeProduct) => ({ endOfLifeProduct, ...(await releaseCycles(endOfLifeProduct, now)) })),
  );

  return { ranAt: readAt, regions, services, products };
}

// Reads one part of a Scan or Discovery, keeping the result of `last`, its
// previous read, if the read fails. Credentials that have expired or need an
// SSO login fail the whole Scan or Discovery.
export async function readPart<T>(read: () => Promise<T>, readAt: string, last: PartRead<T> | undefined): Promise<PartRead<T>> {
  try {
    return { result: await read(), readAt };
  } catch (error) {
    if (!(error instanceof AwsCliError) || error.kind === "expired-credentials") throw error;
    return failedRead(error.message, last);
  }
}

// `reading` as a Scan stores it.
function storedReading({ product, ...reading }: ComponentReading): StoredReading {
  return { ...reading, product: product.endOfLifeProduct };
}

// The Components of `scan`, each matched to its Release Cycle.
export function componentsOf(scan: Scan): ScannedComponent[] {
  if (scan.services === undefined) return scan.components ?? [];
  const products = new Map((scan.products ?? []).map((part) => [part.endOfLifeProduct, part]));
  return scan.services.flatMap((part) =>
    (resultOf(part) ?? []).map((reading) => {
      const productPart = products.get(reading.product);
      // A product endoflife.date has never given matches no Release Cycle.
      const component = matchedComponent(reading, resultOf(productPart) ?? []);
      const lastReadAt = [staleSince(part), staleSince(productPart)].filter((date) => date !== undefined).sort()[0];
      return lastReadAt === undefined ? component : { ...component, stale: { lastReadAt } };
    }),
  );
}

// The parts of `scan` that could not be read.
export function failedPartsOf(scan: Scan): FailedPart[] {
  const failed = (part: ScanPart, read: PartRead<unknown>): FailedPart[] => {
    if (read.error === undefined) return [];
    const lastReadAt = staleSince(read);
    return [lastReadAt === undefined ? { part, error: read.error } : { part, error: read.error, lastReadAt }];
  };
  return [
    ...(scan.regions === undefined ? [] : failed({ kind: "regions" }, scan.regions)),
    ...(scan.services ?? []).flatMap(({ service, region, ...read }) => failed({ kind: "service", service, region }, read)),
    ...(scan.products ?? []).flatMap(({ endOfLifeProduct, ...read }) => failed({ kind: "endoflife.date", product: endOfLifeProduct }, read)),
  ];
}

// The Component `reading` is, matched to one of its Product's Release Cycles,
// given as endoflife.date gives them, with its Drift.
function matchedComponent(
  { product: endOfLifeProduct, newestOffered, ...reading }: StoredReading,
  endOfLifeCycles: ReleaseCycle[],
): ScannedComponent {
  const product: Product = PRODUCTS.get(endOfLifeProduct)!;
  const cycles = product.readReleaseCycle === undefined ? endOfLifeCycles : endOfLifeCycles.map(product.readReleaseCycle);
  // A Component that reports no version could match no Release Cycle.
  const cycleNames = reading.version === undefined ? [] : product.cycleNames(reading.version);
  // Every Release Cycle the version matches, most specific first.
  const matchedCycles = cycleNames.flatMap((name) => cycles.filter((cycle) => cycle.name === name));
  const releaseCycle = matchedCycles[0];
  const drift = {
    latestPatch: driftFrom(
      reading.version === undefined ? undefined : product.latestPatchVersion(reading.version),
      withHighestLatestPatch(matchedCycles)?.latest,
    ),
    newestCycle: driftFromCycle(
      releaseCycle,
      cycleNames,
      releaseCycle !== undefined && product.newestCycle !== undefined ? product.newestCycle(cycles, releaseCycle) : newestCycleOf(cycles),
    ),
    newestOffered: driftFrom(reading.version, newestOffered),
  };
  return { ...reading, product: product.name, releaseCycle, drift };
}

// The regions from `account list-regions` with status ENABLED or
// ENABLED_BY_DEFAULT.
export async function enabledRegions(aws: AwsRunner): Promise<string[]> {
  const stdout = await aws(["account", "list-regions", "--output", "json"]);
  const { Regions } = JSON.parse(stdout) as { Regions: { RegionName: string; RegionOptStatus: string }[] };
  return Regions.filter(({ RegionOptStatus }) => RegionOptStatus === "ENABLED" || RegionOptStatus === "ENABLED_BY_DEFAULT").map(
    ({ RegionName }) => RegionName,
  );
}

// Maps `items` with `map`, running at most `limit` at once, keeping their
// order.
export async function mapConcurrently<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
