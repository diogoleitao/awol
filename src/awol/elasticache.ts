import type { AwsRunner } from "../aws/runner.ts";
import type { ComponentReading, ComponentVersion, Product } from "./component.ts";
import { highestVersion, lowestVersion } from "./drift.ts";

// The ElastiCache Products by Engine.
const PRODUCTS: Record<string, Product> = {
  // By major (`7.1.0` to `7`).
  redis: {
    name: "ElastiCache Redis OSS",
    endOfLifeProduct: "amazon-elasticache-redis",
    cycleNames: (version) => [version.split(".")[0]!],
    latestPatchVersion: (version) => version,
  },
};

// Every ElastiCache Product.
export const ELASTICACHE_PRODUCTS: Product[] = Object.values(PRODUCTS);

type ReplicationGroup = { ReplicationGroupId: string; Engine: string };

type CacheCluster = { CacheClusterId: string; Engine: string; EngineVersion: string; ReplicationGroupId?: string };

type ServerlessCache = { ServerlessCacheName: string; Engine: string; FullEngineVersion: string };

// What an ElastiCache Component reports.
type Cache = { identifier: string; Engine: string; version?: string };

// The ElastiCache replication groups, standalone cache clusters and
// Serverless caches in `region` that are Components. AWS lists a
// replication group's member cache clusters among its cache clusters; a
// member is not a Component: its group is. A replication group reports no
// version, so it takes the lowest of its members', which differ only
// part-way through an upgrade, and has none when AWS lists none of its
// members.
async function listCaches(aws: AwsRunner, region: string): Promise<Cache[]> {
  // One call at a time, so a region makes one call at once.
  const groupsStdout = await aws(["elasticache", "describe-replication-groups", "--region", region, "--output", "json"]);
  const clustersStdout = await aws(["elasticache", "describe-cache-clusters", "--region", region, "--output", "json"]);
  const serverlessStdout = await aws(["elasticache", "describe-serverless-caches", "--region", region, "--output", "json"]);
  const clusters = (JSON.parse(clustersStdout) as { CacheClusters: CacheCluster[] }).CacheClusters;
  return [
    ...(JSON.parse(groupsStdout) as { ReplicationGroups: ReplicationGroup[] }).ReplicationGroups.map((group) => ({
      identifier: group.ReplicationGroupId,
      Engine: group.Engine,
      version: lowestVersion(
        clusters.filter((cluster) => cluster.ReplicationGroupId === group.ReplicationGroupId).map((member) => member.EngineVersion),
      ),
    })),
    ...clusters
      .filter((cluster) => cluster.ReplicationGroupId === undefined)
      .map((cluster) => ({ identifier: cluster.CacheClusterId, Engine: cluster.Engine, version: cluster.EngineVersion })),
    ...(JSON.parse(serverlessStdout) as { ServerlessCaches: ServerlessCache[] }).ServerlessCaches.map((cache) => ({
      identifier: cache.ServerlessCacheName,
      Engine: cache.Engine,
      version: cache.FullEngineVersion,
    })),
  ].filter((cache) => PRODUCTS[cache.Engine] !== undefined);
}

// The ElastiCache Components in `region`, each with its version only.
export async function readElastiCacheVersions(aws: AwsRunner, region: string): Promise<ComponentVersion[]> {
  return (await listCaches(aws, region)).map((cache) => ({
    service: "ElastiCache",
    product: PRODUCTS[cache.Engine]!,
    region,
    identifier: cache.identifier,
    version: cache.version,
  }));
}

// The ElastiCache Components in `region`, each with the Newest offered
// version of its Product there.
export async function readElastiCacheComponents(aws: AwsRunner, region: string): Promise<ComponentReading[]> {
  const caches = await listCaches(aws, region);

  const newestOfferedByEngine = new Map<string, string | undefined>();
  for (const engine of new Set(caches.map((cache) => cache.Engine))) {
    newestOfferedByEngine.set(engine, await readNewestOffered(aws, region, engine));
  }

  return caches.map((cache) => ({
    service: "ElastiCache",
    product: PRODUCTS[cache.Engine]!,
    region,
    identifier: cache.identifier,
    version: cache.version,
    awsLifecycle: {},
    newestOffered: newestOfferedByEngine.get(cache.Engine),
  }));
}

// The highest version of `engine` AWS offers in `region`.
async function readNewestOffered(aws: AwsRunner, region: string, engine: string): Promise<string | undefined> {
  const stdout = await aws(["elasticache", "describe-cache-engine-versions", "--region", region, "--engine", engine, "--output", "json"]);
  const versions = (JSON.parse(stdout) as { CacheEngineVersions: { EngineVersion: string }[] }).CacheEngineVersions;
  return highestVersion(versions.map(({ EngineVersion }) => EngineVersion));
}
