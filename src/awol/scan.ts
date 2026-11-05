import type { AwsRunner } from "../aws/runner.ts";
import type { ReleaseCycle } from "../endoflife/release-cycles.ts";
import type { ComponentReading, ExtendedSupport, Service, SupportDates } from "./component.ts";
import { type Drift, driftFrom, driftFromCycle, newestCycleOf, withHighestLatestPatch } from "./drift.ts";
import { readElastiCacheComponents } from "./elasticache.ts";
import { readRdsComponents } from "./rds.ts";

// How many regions a Scan reads at once.
const REGION_CONCURRENCY = 8;

// The Drift a Scan found for one Component.
export type ComponentDrift = { latestPatch: Drift; newestCycle: Drift; newestOffered: Drift };

// One Component as a Scan stored it: what AWS reported, AWS's support dates
// for its AWS major version, the Release Cycle its version matched, if any,
// and its Drift. A Scan from before awol read AWS's dates and settings has
// none, and one from before it read Drift has no Drift.
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
};

export type Scan = {
  ranAt: string;
  components: ScannedComponent[];
};

// Reads every Component in the regions enabled for the account, and matches
// each to its Release Cycle.
export async function runScan(
  aws: AwsRunner,
  releaseCycles: (endOfLifeProduct: string) => Promise<ReleaseCycle[]>,
  now: Date,
): Promise<Scan> {
  const regions = await enabledRegions(aws);
  const readings = (await mapConcurrently(regions, REGION_CONCURRENCY, (region) => readComponents(aws, region))).flat();

  const endOfLifeProducts = [...new Set(readings.map((reading) => reading.product.endOfLifeProduct))];
  const cyclesByProduct = new Map(
    await Promise.all(
      endOfLifeProducts.map(async (endOfLifeProduct) => [endOfLifeProduct, await releaseCycles(endOfLifeProduct)] as const),
    ),
  );

  return {
    ranAt: now.toISOString(),
    components: readings.map(({ product, newestOffered, ...reading }) => {
      const cycles = cyclesByProduct.get(product.endOfLifeProduct)!;
      // A Component that reports no version could match no Release Cycle.
      const cycleNames = reading.version === undefined ? [] : product.cycleNames(reading.version);
      // Every Release Cycle the version matches, most specific first.
      const matched = cycleNames.flatMap((name) => cycles.filter((cycle) => cycle.name === name));
      const releaseCycle = matched[0];
      const drift = {
        latestPatch: driftFrom(
          reading.version === undefined ? undefined : product.latestPatchVersion(reading.version),
          withHighestLatestPatch(matched)?.latest,
        ),
        newestCycle: driftFromCycle(releaseCycle, cycleNames, newestCycleOf(cycles)),
        newestOffered: driftFrom(reading.version, newestOffered),
      };
      return { ...reading, product: product.name, releaseCycle, drift };
    }),
  };
}

// The Components of every service in `region`, one service at a time, so a
// region makes one call at once.
async function readComponents(aws: AwsRunner, region: string): Promise<ComponentReading[]> {
  return [...(await readRdsComponents(aws, region)), ...(await readElastiCacheComponents(aws, region))];
}

// The regions from `account list-regions` with status ENABLED or
// ENABLED_BY_DEFAULT.
async function enabledRegions(aws: AwsRunner): Promise<string[]> {
  const stdout = await aws(["account", "list-regions", "--output", "json"]);
  const { Regions } = JSON.parse(stdout) as { Regions: { RegionName: string; RegionOptStatus: string }[] };
  return Regions.filter(({ RegionOptStatus }) => RegionOptStatus === "ENABLED" || RegionOptStatus === "ENABLED_BY_DEFAULT").map(
    ({ RegionName }) => RegionName,
  );
}

// Maps `items` with `map`, running at most `limit` at once, keeping their
// order.
async function mapConcurrently<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
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
