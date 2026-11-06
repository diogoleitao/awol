import { AwsCliError, type AwsRunner } from "../aws/runner.ts";
import { type PartRead, resultOf, staleSince } from "../part-read.ts";
import type { ComponentVersion, Service } from "./component.ts";
import { readElastiCacheVersions } from "./elasticache.ts";
import { readLambdaComponents } from "./lambda.ts";
import { readOpenSearchVersions } from "./opensearch.ts";
import { readRdsVersions } from "./rds.ts";
import { enabledRegions, mapConcurrently, readPart, REGION_CONCURRENCY, type Stale } from "./scan.ts";

// The services Discovery counts that awol monitors, in the order the
// dashboard shows them.
export const SUPPORTED_SERVICES = ["RDS", "Aurora", "ElastiCache Redis OSS", "OpenSearch Service", "Lambda"] as const;

// The versioned services Discovery counts that awol cannot monitor yet, in
// the order the dashboard shows them.
export const UNSUPPORTED_SERVICES = [
  "EKS",
  "MSK",
  "DocumentDB",
  "Neptune",
  "Amazon MQ",
  "ElastiCache Valkey",
  "ElastiCache Memcached",
  "MemoryDB",
  "Elastic Beanstalk",
  "RDS Oracle",
  "RDS SQL Server",
  "EC2",
] as const;

// A service Discovery counts, supported or not.
export type DiscoveredService = (typeof SUPPORTED_SERVICES)[number] | (typeof UNSUPPORTED_SERVICES)[number];

// The AWS services whose calls Discovery counts resources with. One AWS
// service's calls can count several services: RDS's count Aurora, RDS
// Oracle and SQL Server, DocumentDB and Neptune too.
export type AwsService = Service | "EKS" | "MSK" | "Amazon MQ" | "MemoryDB" | "Elastic Beanstalk" | "EC2";

// How many resources of each service one AWS service's calls found in a
// region, zero included.
type Counts = Partial<Record<DiscoveredService, number>>;

// What one AWS service's calls found in a region, or that it has no
// endpoint there.
export type Presence = { kind: "counted"; counts: Counts } | { kind: "not-in-region" };

// The resources of each service one AWS service has in one region.
type PresencePart = { awsService: AwsService; region: string } & PartRead<Presence>;

// One Component Discovery read: the service and Product it is of, and its
// version, if it reports one.
export type DiscoveredComponent = { service: DiscoveredService; product: string; identifier: string; version?: string };

// The Components one AWS service a Scan reads has in one region.
type VersionsPart = { service: Service; region: string } & PartRead<DiscoveredComponent[]>;

// A Discovery, kept by part: the regions enabled for the account, what each
// AWS service has in each of them, and the Components of each AWS service a
// Scan reads where it has any. It started at `startedAt`, and one still
// running, or stopped part-way, has no `finishedAt`.
export type Discovery = {
  startedAt: string;
  finishedAt?: string;
  regions?: PartRead<string[]>;
  presence: PresencePart[];
  versions: VersionsPart[];
};

// A part of a Discovery, as the dashboard names it.
export type DiscoveryPart =
  | { kind: "regions" }
  | { kind: "presence"; awsService: AwsService; region: string }
  | { kind: "versions"; service: Service; region: string };

// The supported services of each AWS service a Scan reads.
const SUPPORTED_BY: Record<Service, DiscoveredService[]> = {
  RDS: ["RDS", "Aurora"],
  ElastiCache: ["ElastiCache Redis OSS"],
  OpenSearch: ["OpenSearch Service"],
  Lambda: ["Lambda"],
};

// The AWS services a Scan reads, in the order Discovery reads their
// Components' versions in each region, without AWS's support dates or
// offered versions, which Discovery does not show. A Lambda Component's
// reading is its version only.
const VERSIONS: [Service, (aws: AwsRunner, region: string) => Promise<ComponentVersion[]>][] = [
  ["RDS", readRdsVersions],
  ["ElastiCache", readElastiCacheVersions],
  ["OpenSearch", readOpenSearchVersions],
  ["Lambda", readLambdaComponents],
];

// `component` as Discovery keeps it: Aurora clusters are Aurora's, and every
// other RDS Component is RDS's.
function discoveredComponent({ service, product, identifier, version }: ComponentVersion): DiscoveredComponent {
  const aurora = service === "RDS" && product.endOfLifeProduct.startsWith("amazon-aurora-");
  return { service: aurora ? "Aurora" : SUPPORTED_BY[service][0]!, product: product.name, identifier, version };
}

// The services each AWS service's calls count.
const COUNTED_BY: Record<AwsService, DiscoveredService[]> = {
  RDS: ["RDS", "Aurora", "RDS Oracle", "RDS SQL Server", "DocumentDB", "Neptune"],
  ElastiCache: ["ElastiCache Redis OSS", "ElastiCache Valkey", "ElastiCache Memcached"],
  OpenSearch: ["OpenSearch Service"],
  Lambda: ["Lambda"],
  EKS: ["EKS"],
  MSK: ["MSK"],
  "Amazon MQ": ["Amazon MQ"],
  MemoryDB: ["MemoryDB"],
  "Elastic Beanstalk": ["Elastic Beanstalk"],
  EC2: ["EC2"],
};

// What `presence` counted, none where its AWS service is not in the region.
function countsOf(presence: Presence | undefined): Counts {
  return presence?.kind === "counted" ? presence.counts : {};
}

// Whether `presence` found resources of a supported service of `service`.
function hasComponents(presence: PresencePart[], service: Service, region: string): boolean {
  const counts = countsOf(resultOf(presence.find((part) => part.awsService === service && part.region === region)));
  return SUPPORTED_BY[service].some((supported) => (counts[supported] ?? 0) > 0);
}

// A part of the last Discovery that could not be read, with its error: Stale
// with when it was last read successfully, or never read successfully.
export type FailedDiscoveryPart = { part: DiscoveryPart; error: string } & Partial<Stale>;

// The JSON a call for the resources in `region` answers with.
async function list<T>(aws: AwsRunner, region: string, [service, subcommand, ...options]: string[]): Promise<T> {
  return JSON.parse(await aws([service!, subcommand!, "--region", region, ...options, "--output", "json"])) as T;
}

// How many of `found` are each of `services`, zero included. A resource of
// no service Discovery counts is undefined.
function tally(services: readonly DiscoveredService[], found: (DiscoveredService | undefined)[]): Counts {
  return Object.fromEntries(services.map((service) => [service, found.filter((other) => other === service).length]));
}

// The service an RDS instance or DB cluster counts as, by Engine: Multi-AZ
// DB clusters count as RDS.
function rdsServiceOf(engine: string): DiscoveredService | undefined {
  if (engine === "postgres" || engine === "mysql" || engine === "mariadb") return "RDS";
  if (engine === "aurora-postgresql" || engine === "aurora-mysql") return "Aurora";
  if (engine.includes("oracle")) return "RDS Oracle";
  if (engine.includes("sqlserver")) return "RDS SQL Server";
  if (engine === "docdb") return "DocumentDB";
  if (engine === "neptune") return "Neptune";
  return undefined;
}

// The service an ElastiCache cache counts as, by Engine.
const ELASTICACHE_SERVICES: Record<string, DiscoveredService> = {
  redis: "ElastiCache Redis OSS",
  valkey: "ElastiCache Valkey",
  memcached: "ElastiCache Memcached",
};

// The calls each AWS service counts its resources in a region with, the way
// a Scan finds Components where it reads them: an RDS instance in a DB
// cluster, or an ElastiCache cache cluster in a replication group, is not
// counted, its cluster or group is.
const PRESENCE: [AwsService, (aws: AwsRunner, region: string) => Promise<Counts>][] = [
  [
    "RDS",
    async (aws, region) => {
      // One call at a time, so a region makes one call at once.
      const { DBInstances } = await list<{ DBInstances: { Engine: string; DBClusterIdentifier?: string }[] }>(aws, region, [
        "rds",
        "describe-db-instances",
      ]);
      const { DBClusters } = await list<{ DBClusters: { Engine: string }[] }>(aws, region, ["rds", "describe-db-clusters"]);
      return tally(
        COUNTED_BY.RDS,
        [...DBInstances.filter((instance) => instance.DBClusterIdentifier === undefined), ...DBClusters].map(({ Engine }) =>
          rdsServiceOf(Engine),
        ),
      );
    },
  ],
  [
    "ElastiCache",
    async (aws, region) => {
      const { ReplicationGroups } = await list<{ ReplicationGroups: { Engine: string }[] }>(aws, region, [
        "elasticache",
        "describe-replication-groups",
      ]);
      const { CacheClusters } = await list<{ CacheClusters: { Engine: string; ReplicationGroupId?: string }[] }>(aws, region, [
        "elasticache",
        "describe-cache-clusters",
      ]);
      const { ServerlessCaches } = await list<{ ServerlessCaches: { Engine: string }[] }>(aws, region, [
        "elasticache",
        "describe-serverless-caches",
      ]);
      return tally(
        COUNTED_BY.ElastiCache,
        [...ReplicationGroups, ...CacheClusters.filter((cluster) => cluster.ReplicationGroupId === undefined), ...ServerlessCaches].map(
          ({ Engine }) => ELASTICACHE_SERVICES[Engine],
        ),
      );
    },
  ],
  [
    "OpenSearch",
    async (aws, region) => {
      const { DomainNames } = await list<{ DomainNames: unknown[] }>(aws, region, ["opensearch", "list-domain-names"]);
      return { "OpenSearch Service": DomainNames.length };
    },
  ],
  [
    "Lambda",
    async (aws, region) => {
      const { Functions } = await list<{ Functions: unknown[] }>(aws, region, ["lambda", "list-functions"]);
      return { Lambda: Functions.length };
    },
  ],
  [
    "EKS",
    async (aws, region) => {
      const { clusters } = await list<{ clusters: unknown[] }>(aws, region, ["eks", "list-clusters"]);
      return { EKS: clusters.length };
    },
  ],
  [
    "MSK",
    async (aws, region) => {
      const { ClusterInfoList } = await list<{ ClusterInfoList: unknown[] }>(aws, region, ["kafka", "list-clusters-v2"]);
      return { MSK: ClusterInfoList.length };
    },
  ],
  [
    "Amazon MQ",
    async (aws, region) => {
      const { BrokerSummaries } = await list<{ BrokerSummaries: unknown[] }>(aws, region, ["mq", "list-brokers"]);
      return { "Amazon MQ": BrokerSummaries.length };
    },
  ],
  [
    "MemoryDB",
    async (aws, region) => {
      const { Clusters } = await list<{ Clusters: unknown[] }>(aws, region, ["memorydb", "describe-clusters"]);
      return { MemoryDB: Clusters.length };
    },
  ],
  [
    "Elastic Beanstalk",
    async (aws, region) => {
      // Without it, AWS lists recently deleted environments too.
      const { Environments } = await list<{ Environments: unknown[] }>(aws, region, [
        "elasticbeanstalk",
        "describe-environments",
        "--no-include-deleted",
      ]);
      return { "Elastic Beanstalk": Environments.length };
    },
  ],
  [
    "EC2",
    async (aws, region) => {
      // AWS lists a terminated instance for about an hour after.
      const { Reservations } = await list<{ Reservations: { Instances: { State: { Name: string } }[] }[] }>(aws, region, [
        "ec2",
        "describe-instances",
      ]);
      return { EC2: Reservations.flatMap(({ Instances }) => Instances).filter(({ State }) => State.Name !== "terminated").length };
    },
  ],
];

// What a Discovery does with the parts the last one read successfully:
// reads them again, or keeps them and reads only the failed or Stale ones.
export type DiscoveryScope = "all" | "failed";

// Runs a Discovery of the account: lists its enabled regions, then counts
// the resources of each AWS service in each, then reads the versions of the
// Components of each AWS service a Scan reads where it found a supported
// service's resources. Each part is saved with `save` as it is read. A part
// that cannot be read keeps its result from `previous`, the account's last
// Discovery, Stale. With scope "failed", a part `previous` read successfully
// is kept as it is, and not read again, except a region's versions of an
// AWS service whose resources there are read again, so the two agree.
// Credentials that have expired or need an SSO login stop the Discovery,
// saving nothing more, and are thrown.
export async function runDiscovery(
  aws: AwsRunner,
  now: () => Date,
  previous: Discovery | undefined,
  scope: DiscoveryScope,
  save: (discovery: Discovery) => Promise<void>,
): Promise<void> {
  const { finishedAt: _, ...kept } = previous ?? { presence: [], versions: [] };
  let discovery: Discovery = { ...kept, startedAt: now().toISOString() };
  let stopped = false;

  // Changes the Discovery and saves it, unless it has stopped.
  async function keep(change: (discovery: Discovery) => Discovery) {
    if (stopped) return;
    discovery = change(discovery);
    await save(discovery);
  }

  // `last` kept as it is, when only failed parts are read, `last` was read
  // successfully and `mayKeep`, or else `read` read now, keeping `last`'s
  // result if it fails.
  async function readOrKeep<T>(
    read: () => Promise<T>,
    last: PartRead<T> | undefined,
    mayKeep = true,
  ): Promise<PartRead<T> | undefined> {
    if (scope === "failed" && mayKeep && last !== undefined && last.error === undefined) return undefined;
    return readPart(read, now().toISOString(), last);
  }

  try {
    await keep((discovery) => discovery);
    const regions = (await readOrKeep(() => enabledRegions(aws), previous?.regions)) ?? previous!.regions!;
    if (regions !== previous?.regions) await keep((discovery) => ({ ...discovery, regions }));
    const enabled = resultOf(regions) ?? [];

    await mapConcurrently(enabled, REGION_CONCURRENCY, async (region) => {
      // The AWS services whose resources in the region were read again.
      const reread = new Set<AwsService>();
      // One AWS service at a time, so a region makes one call at once.
      for (const [awsService, count] of PRESENCE) {
        if (stopped) return;
        const same = (part: PresencePart) => part.awsService === awsService && part.region === region;
        const read = await readOrKeep(() => presenceIn(aws, region, count), previous?.presence.find(same));
        if (read === undefined) continue;
        reread.add(awsService);
        await keep((discovery) => ({ ...discovery, presence: replaced(discovery.presence, same, { awsService, region, ...read }) }));
      }
      for (const [service, readVersions] of VERSIONS) {
        if (stopped || !hasComponents(discovery.presence, service, region)) continue;
        const same = (part: VersionsPart) => part.service === service && part.region === region;
        const read = await readOrKeep(
          async () => (await readVersions(aws, region)).map(discoveredComponent),
          previous?.versions.find(same),
          !reread.has(service),
        );
        if (read === undefined) continue;
        await keep((discovery) => ({ ...discovery, versions: replaced(discovery.versions, same, { service, region, ...read }) }));
      }
    });

    // The parts of regions no longer enabled go, and the Components of AWS
    // services that no longer have any.
    await keep((discovery) => ({
      ...discovery,
      finishedAt: now().toISOString(),
      presence: discovery.presence.filter((part) => enabled.includes(part.region)),
      versions: discovery.versions.filter(
        (part) => enabled.includes(part.region) && hasComponents(discovery.presence, part.service, part.region),
      ),
    }));
  } catch (error) {
    stopped = true;
    throw error;
  }
}

// What `count` finds in `region`, or that its AWS service is not there.
async function presenceIn(aws: AwsRunner, region: string, count: (aws: AwsRunner, region: string) => Promise<Counts>): Promise<Presence> {
  try {
    return { kind: "counted", counts: await count(aws, region) };
  } catch (error) {
    if (error instanceof AwsCliError && error.kind === "not-available") return { kind: "not-in-region" };
    throw error;
  }
}

// `parts` with the one that is `same` replaced by `part` where it is, or
// `part` added last.
function replaced<T>(parts: T[], same: (part: T) => boolean, part: T): T[] {
  const index = parts.findIndex(same);
  return index === -1 ? [...parts, part] : parts.with(index, part);
}

// One service Discovery counts, as the dashboard shows it: whether awol
// monitors it, how many resources it has in all, how many in each region
// with any, Stale where that region's part could not be read, the regions
// it has no endpoint in, and, for a supported service, how many of its
// Components run each version of each Product, by Product and then version,
// with no version last.
export type DiscoveredServiceRow = {
  service: DiscoveredService;
  supported: boolean;
  count: number;
  regions: ({ region: string; count: number } & { stale?: Stale })[];
  notInRegions: string[];
  versions: { product: string; version?: string; count: number }[];
};

// The last Discovery as the dashboard shows it: when it started and, if it
// has, finished, the regions it read, every service it counts, supported
// first, and the parts of it that could not be read.
export type DiscoveryResult = {
  startedAt: string;
  finishedAt?: string;
  regions: string[];
  services: DiscoveredServiceRow[];
  failedParts: FailedDiscoveryPart[];
};

// `discovery` as the dashboard shows it: each service's resources summed
// over the regions, Stale where they come from a part that could not be
// read, and the versions of its Components counted.
export function discoveryResultOf(discovery: Discovery): DiscoveryResult {
  const services = [...SUPPORTED_SERVICES, ...UNSUPPORTED_SERVICES].map((service): DiscoveredServiceRow => {
    const parts = discovery.presence
      .filter(({ awsService }) => COUNTED_BY[awsService].includes(service))
      .sort((a, b) => a.region.localeCompare(b.region));
    const regions = parts.flatMap((part) => {
      const count = countsOf(resultOf(part))[service] ?? 0;
      if (count === 0) return [];
      const lastReadAt = staleSince(part);
      return [lastReadAt === undefined ? { region: part.region, count } : { region: part.region, count, stale: { lastReadAt } }];
    });
    return {
      service,
      supported: (SUPPORTED_SERVICES as readonly string[]).includes(service),
      count: regions.reduce((sum, { count }) => sum + count, 0),
      regions,
      notInRegions: parts.filter((part) => resultOf(part)?.kind === "not-in-region").map(({ region }) => region),
      versions: versionsOf(discovery.versions.flatMap((part) => (resultOf(part) ?? []).filter((component) => component.service === service))),
    };
  });
  const failed = (part: DiscoveryPart, read: PartRead<unknown>): FailedDiscoveryPart[] => {
    if (read.error === undefined) return [];
    const lastReadAt = staleSince(read);
    return [lastReadAt === undefined ? { part, error: read.error } : { part, error: read.error, lastReadAt }];
  };
  return {
    startedAt: discovery.startedAt,
    ...(discovery.finishedAt === undefined ? {} : { finishedAt: discovery.finishedAt }),
    regions: resultOf(discovery.regions) ?? [],
    services,
    failedParts: [
      ...(discovery.regions === undefined ? [] : failed({ kind: "regions" }, discovery.regions)),
      ...inOrder(discovery.presence, ({ awsService }) => PRESENCE.findIndex(([other]) => other === awsService)).flatMap(
        ({ awsService, region, ...read }) => failed({ kind: "presence", awsService, region }, read),
      ),
      ...inOrder(discovery.versions, ({ service }) => VERSIONS.findIndex(([other]) => other === service)).flatMap(
        ({ service, region, ...read }) => failed({ kind: "versions", service, region }, read),
      ),
    ],
  };
}

// `parts` by region, and in each region by `rank`.
function inOrder<T extends { region: string }>(parts: T[], rank: (part: T) => number): T[] {
  return parts.toSorted((a, b) => a.region.localeCompare(b.region) || rank(a) - rank(b));
}

// How many of `components` run each version of each Product, by Product and
// then version, with no version last.
function versionsOf(components: DiscoveredComponent[]): DiscoveredServiceRow["versions"] {
  const versions = new Map<string, DiscoveredServiceRow["versions"][number]>();
  for (const { product, version } of components) {
    const key = JSON.stringify([product, version]);
    const entry = versions.get(key) ?? { product, version, count: 0 };
    entry.count += 1;
    versions.set(key, entry);
  }
  return [...versions.values()].sort(
    (a, b) =>
      a.product.localeCompare(b.product) ||
      (a.version === undefined ? 1 : 0) - (b.version === undefined ? 1 : 0) ||
      (a.version ?? "").localeCompare(b.version ?? "", "en", { numeric: true }),
  );
}
