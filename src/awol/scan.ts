import type { AwsRunner } from "../aws/runner.ts";
import type { ReleaseCycle } from "../endoflife/release-cycles.ts";
import { readRdsInstances } from "./rds.ts";

// How many regions a Scan reads at once.
const REGION_CONCURRENCY = 8;

// One Component as a Scan stored it: what AWS reported, and the Release Cycle
// its version matched, if any.
export type ScannedComponent = {
  service: "RDS";
  product: string;
  region: string;
  identifier: string;
  version: string;
  releaseCycle?: ReleaseCycle;
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
  const readings = (await mapConcurrently(regions, REGION_CONCURRENCY, (region) => readRdsInstances(aws, region))).flat();

  const endOfLifeProducts = [...new Set(readings.map((reading) => reading.product.endOfLifeProduct))];
  const cyclesByProduct = new Map(
    await Promise.all(
      endOfLifeProducts.map(async (endOfLifeProduct) => [endOfLifeProduct, await releaseCycles(endOfLifeProduct)] as const),
    ),
  );

  return {
    ranAt: now.toISOString(),
    components: readings.map(({ product, ...reading }) => {
      const cycles = cyclesByProduct.get(product.endOfLifeProduct)!;
      const releaseCycle = product
        .cycleNames(reading.version)
        .map((name) => cycles.find((cycle) => cycle.name === name))
        .find((cycle) => cycle !== undefined);
      return { ...reading, product: product.name, releaseCycle };
    }),
  };
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
