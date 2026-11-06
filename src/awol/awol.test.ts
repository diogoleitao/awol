import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isReadOnly } from "../aws/read-only.ts";
import { type AwsRunner, awsCliError } from "../aws/runner.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import { openAwol, type Progress } from "./awol.ts";
import { SUPPORTED_SERVICES } from "./component.ts";
import { type DashboardView, dashboardViewOf, filterOptionsOf, INITIAL_TABLE_STATE, NO_FILTERS, nextSort } from "./dashboard-view.ts";
import { nextStepOf } from "./next-step.ts";
import type { DiscoveryResult, LastScan, SignedIn } from "./page-model.ts";
import { topBarOf } from "./top-bar.ts";
// Recorded from `aws sts get-caller-identity --output json` against a real
// account, then stripped of the account ID, user ID and user name.
import callerIdentity from "./fixtures/sts-get-caller-identity.json" with { type: "json" };
// Written by hand from the `aws` CLI's messages, since recording them needs an
// expired or missing session: an SSO token that could not be refreshed, an
// SSO session that has expired, an SSO session never logged in to, and
// expired temporary credentials.
import credentialErrors from "./fixtures/credential-errors.json" with { type: "json" };
// Written by hand from the `aws` CLI's messages, since recording them needs a
// denied, throttled or unreachable call: AccessDenied for RDS and for the
// account's regions, throttling past the CLI's retries, and a service with no
// endpoint in the region.
import awsErrors from "./fixtures/aws-errors.json" with { type: "json" };
// Recorded from `aws account list-regions --output json`. The account has no
// opted-in region, so tests that need one change a recorded status.
import listRegions from "./fixtures/account-list-regions.json" with { type: "json" };
// Recorded from `aws rds describe-db-instances --region eu-west-1 --output
// json`: five of the account's 21 instances, one per Engine and version, kept
// to the fields that identify nothing and renamed db-1 to db-5. Every other
// enabled region answered with no instances.
import describeDbInstances from "./fixtures/rds-describe-db-instances.json" with { type: "json" };
// Written by hand in the shape of `aws rds describe-db-clusters --region
// eu-west-1 --output json`, since no enabled region of the recorded account
// has a DB cluster: an Aurora PostgreSQL cluster, an Aurora MySQL cluster, a
// Multi-AZ DB cluster, a DocumentDB cluster and a Neptune cluster, named
// cluster-1 to cluster-5.
import describeDbClusters from "./fixtures/rds-describe-db-clusters.json" with { type: "json" };
// Recorded from `aws rds describe-db-major-engine-versions --region eu-west-1
// --engine <engine> --output json` on 2026-11-03, and on 2026-11-05 for the
// Aurora engines. The answer is the same for every account.
import postgresMajorVersions from "./fixtures/rds-describe-db-major-engine-versions/postgres.json" with { type: "json" };
import mysqlMajorVersions from "./fixtures/rds-describe-db-major-engine-versions/mysql.json" with { type: "json" };
import mariadbMajorVersions from "./fixtures/rds-describe-db-major-engine-versions/mariadb.json" with { type: "json" };
import auroraPostgresqlMajorVersions from "./fixtures/rds-describe-db-major-engine-versions/aurora-postgresql.json" with { type: "json" };
import auroraMysqlMajorVersions from "./fixtures/rds-describe-db-major-engine-versions/aurora-mysql.json" with { type: "json" };
// Recorded from `aws rds describe-db-engine-versions --region eu-west-1
// --engine <engine> --output json` on 2026-11-03, and on 2026-11-05 for the
// Aurora engines, kept to the fields that name each version. The answer is
// the same for every account.
import postgresEngineVersions from "./fixtures/rds-describe-db-engine-versions/postgres.json" with { type: "json" };
import mysqlEngineVersions from "./fixtures/rds-describe-db-engine-versions/mysql.json" with { type: "json" };
import mariadbEngineVersions from "./fixtures/rds-describe-db-engine-versions/mariadb.json" with { type: "json" };
import auroraPostgresqlEngineVersions from "./fixtures/rds-describe-db-engine-versions/aurora-postgresql.json" with { type: "json" };
import auroraMysqlEngineVersions from "./fixtures/rds-describe-db-engine-versions/aurora-mysql.json" with { type: "json" };
// Recorded from endoflife.date's API on 2026-11-03, and on 2026-11-05 for the
// Aurora products.
import rdsPostgresql from "./fixtures/endoflife/amazon-rds-postgresql.json" with { type: "json" };
import rdsMysql from "./fixtures/endoflife/amazon-rds-mysql.json" with { type: "json" };
import rdsMariadb from "./fixtures/endoflife/amazon-rds-mariadb.json" with { type: "json" };
import auroraPostgresql from "./fixtures/endoflife/amazon-aurora-postgresql.json" with { type: "json" };
import auroraMysql from "./fixtures/endoflife/amazon-aurora-mysql.json" with { type: "json" };
// Recorded from `aws elasticache describe-replication-groups --region
// eu-west-1 --output json` and `aws elasticache describe-cache-clusters
// --region eu-west-1 --output json` on 2026-11-05: five of the account's 25
// replication groups, one per Engine and version, with their member cache
// clusters, and one of its two standalone cache clusters, kept to the fields
// that identify nothing and renamed group-1 to group-5 and cache-1. Every
// other enabled region answered with none.
import describeReplicationGroups from "./fixtures/elasticache-describe-replication-groups.json" with { type: "json" };
import describeCacheClusters from "./fixtures/elasticache-describe-cache-clusters.json" with { type: "json" };
// Written by hand in the shape of `aws elasticache describe-serverless-caches
// --region eu-west-1 --output json`, since no enabled region of the recorded
// account has a Serverless cache: a Redis OSS, a Valkey and a Memcached
// cache, named serverless-1 to serverless-3.
import describeServerlessCaches from "./fixtures/elasticache-describe-serverless-caches.json" with { type: "json" };
// Recorded from `aws elasticache describe-cache-engine-versions --region
// eu-west-1 --engine redis --output json` on 2026-11-05, kept to the fields
// that name each version. The answer is the same for every account.
import redisCacheEngineVersions from "./fixtures/elasticache-describe-cache-engine-versions/redis.json" with { type: "json" };
// Recorded from endoflife.date's API on 2026-11-05.
import elasticacheRedis from "./fixtures/endoflife/amazon-elasticache-redis.json" with { type: "json" };
// Written by hand in the shape of `aws opensearch describe-domains --region
// eu-west-1 --domain-names <name>... --output json`, since no enabled region
// of the recorded account has a domain: an OpenSearch 2.11, an Elasticsearch
// 7.10 and an OpenSearch 3.5 domain, named domain-1 to domain-3.
import describeDomains from "./fixtures/opensearch-describe-domains.json" with { type: "json" };
// Recorded from `aws opensearch list-versions --region eu-west-1 --output
// json` on 2026-11-05. The answer is the same for every account.
import openSearchVersions from "./fixtures/opensearch-list-versions.json" with { type: "json" };
// Recorded from endoflife.date's API on 2026-11-05.
import amazonOpenSearch from "./fixtures/endoflife/amazon-opensearch.json" with { type: "json" };
import amazonElasticsearch from "./fixtures/endoflife/amazon-elasticsearch.json" with { type: "json" };
// Recorded from `aws lambda list-functions --region eu-west-1 --output json`
// on 2026-11-05: ten of the account's 92 functions, one per Runtime and
// PackageType, kept to the fields that identify nothing and renamed
// function-1 to function-10. Every other enabled region was not read.
import listFunctions from "./fixtures/lambda-list-functions.json" with { type: "json" };
// Written by hand in the shape of `aws lambda list-aliases --region eu-west-1
// --function-name <name> --output json`, since no function of the recorded
// account has an alias: an alias on $LATEST, a weighted alias on versions 12
// and 11, a second alias on 12, and one on 9.
import listAliases from "./fixtures/lambda-list-aliases.json" with { type: "json" };
// Recorded from endoflife.date's API on 2026-11-05.
import awsLambda from "./fixtures/endoflife/aws-lambda.json" with { type: "json" };
// Written by hand in the shape of `aws <service> <subcommand> --region
// eu-west-1 --output json` for the services Discovery counts but awol does
// not monitor, since the recorded account runs none of them: two EKS
// clusters, an MSK cluster, an Amazon MQ broker, a MemoryDB cluster, two
// Elastic Beanstalk environments, and three EC2 instances, one of them
// terminated.
import eksListClusters from "./fixtures/eks-list-clusters.json" with { type: "json" };
import kafkaListClusters from "./fixtures/kafka-list-clusters-v2.json" with { type: "json" };
import mqListBrokers from "./fixtures/mq-list-brokers.json" with { type: "json" };
import memorydbDescribeClusters from "./fixtures/memorydb-describe-clusters.json" with { type: "json" };
import elasticBeanstalkEnvironments from "./fixtures/elasticbeanstalk-describe-environments.json" with { type: "json" };
import ec2DescribeInstances from "./fixtures/ec2-describe-instances.json" with { type: "json" };

const NOW = new Date("2026-11-03T12:00:00Z");

const CALLER_IDENTITY = "sts get-caller-identity --output json";

// What the `aws` CLI answers one argv with: its stdout, or the stderr of a
// failed call.
type Answer = { stdout: string } | { stderr: string };

// The recorded identity of account 123456789012.
const SIGNED_IN: Answer = { stdout: JSON.stringify(callerIdentity) };

// The recorded identity, moved to a second account the way switching
// profiles would.
const SIGNED_IN_ELSEWHERE: Answer = {
  stdout: JSON.stringify({ ...callerIdentity, Account: "210987654321", Arn: "arn:aws:iam::210987654321:user/user-1" }),
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "awol-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Replays answers keyed by argv, joined with spaces. A failed call throws the
// error the real runner makes from the same stderr. An argv with no answer
// fails the test.
function fakeAws(answers: Record<string, Answer>): AwsRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return Object.assign(
    async (argv: string[]) => {
      calls.push(argv);
      const answer = answers[argv.join(" ")];
      if (answer === undefined) throw new Error(`no recorded answer for \`aws ${argv.join(" ")}\``);
      if ("stderr" in answer) throw awsCliError(argv, answer.stderr);
      return answer.stdout;
    },
    { calls },
  );
}

// The ETags endoflife.date sent with the recorded products.
const RECORDED_PRODUCTS: Record<string, { etag: string; body: unknown }> = {
  "amazon-rds-postgresql": { etag: '"8657de974096f1d9de7976eb94ccaf05-ssl"', body: rdsPostgresql },
  "amazon-rds-mysql": { etag: '"8274b83b7bb3c944a2eed9fe4d991165-ssl"', body: rdsMysql },
  "amazon-rds-mariadb": { etag: '"66f9d176975fe23036020e9cda3d2073-ssl"', body: rdsMariadb },
  "amazon-aurora-postgresql": { etag: '"d520db051d8e2e26ef6857339573e37a-ssl"', body: auroraPostgresql },
  "amazon-aurora-mysql": { etag: '"9df9b18955a960f890a086ca94b02c84-ssl"', body: auroraMysql },
  "amazon-elasticache-redis": { etag: '"0670dbddd644eb99ba19e1206ad8360e-ssl"', body: elasticacheRedis },
  "amazon-opensearch": { etag: '"a5edfe1e32572074c3582e03213b7b68-ssl"', body: amazonOpenSearch },
  "amazon-elasticsearch": { etag: '"04c356436f35e51ed1567eb238e49050-ssl"', body: amazonElasticsearch },
  "aws-lambda": { etag: '"7010828a001da46c660286efd80cb276-ssl"', body: awsLambda },
};

// Replays endoflife.date: each product's recorded body with its ETag, or a
// 304 with no body when sent that ETag. Products can be swapped for other
// bodies. A URL with no product fails the test.
function fakeEndOfLife(
  products: Record<string, { etag: string; body: unknown }> = RECORDED_PRODUCTS,
): EndOfLifeFetcher & { calls: { url: string; etag?: string }[] } {
  const calls: { url: string; etag?: string }[] = [];
  return Object.assign(
    async (url: string, etag?: string) => {
      calls.push(etag === undefined ? { url } : { url, etag });
      const name = url.match(/^https:\/\/endoflife\.date\/api\/v1\/products\/([a-z0-9-]+)$/)?.[1];
      const product = name === undefined ? undefined : products[name];
      if (product === undefined) throw new Error(`unexpected endoflife.date fetch of ${url}`);
      if (etag === product.etag) return { status: 304, etag: product.etag, body: "" };
      return { status: 200, etag: product.etag, body: JSON.stringify(product.body) };
    },
    { calls },
  );
}

function awol(aws: AwsRunner, now = NOW, endOfLife: EndOfLifeFetcher = fakeEndOfLife()) {
  return openAwol({ aws, endOfLife, dataDir: dir, clock: { now: () => now } });
}

// A Scan on `now` of an account that monitors every supported service.
async function scanAll(aws: AwsRunner, now = NOW, endOfLife: EndOfLifeFetcher = fakeEndOfLife()) {
  await awol(aws, now, endOfLife).setMonitoredServices([...SUPPORTED_SERVICES]);
  return awol(aws, now, endOfLife).scan();
}

// Ends every test: awol only ever asked the CLI to read, and for JSON.
function expectOnlyJsonReads(aws: { calls: string[][] }) {
  expect(aws.calls.length).toBeGreaterThan(0);
  for (const argv of aws.calls) {
    expect(isReadOnly(argv), `aws ${argv.join(" ")}`).toBe(true);
    expect(argv.join(" "), `aws ${argv.join(" ")}`).toMatch(/ --output json( |$)/);
  }
}

describe("the dashboard", () => {
  it("shows the AWS account of the active profile", async () => {
    const aws = fakeAws({ [CALLER_IDENTITY]: SIGNED_IN });

    expect(await awol(aws).pageModel()).toEqual({ kind: "signed-in", accountId: "123456789012" });
    expectOnlyJsonReads(aws);
  });

  it.each([
    ["an expired SSO token", credentialErrors.ssoTokenExpired],
    ["an expired SSO session", credentialErrors.ssoSessionExpired],
    ["an SSO session never logged in to", credentialErrors.ssoLoginNeeded],
    ["expired temporary credentials", credentialErrors.expiredToken],
  ])("asks to log in again after %s, instead of showing an account", async (_, stderr) => {
    const aws = fakeAws({ [CALLER_IDENTITY]: { stderr } });

    expect(await awol(aws).pageModel()).toEqual({ kind: "login-needed", reason: stderr.trim() });
    expectOnlyJsonReads(aws);
  });
});

describe("the state of each AWS account", () => {
  const LATER = new Date("2026-11-04T08:30:00Z");

  async function storedState(accountId: string) {
    return JSON.parse(await readFile(path.join(dir, "accounts", accountId, "state.json"), "utf8"));
  }

  it("records when awol first and last saw the account", async () => {
    const aws = fakeAws({ [CALLER_IDENTITY]: SIGNED_IN });

    await awol(aws, NOW).pageModel();
    expect(await storedState("123456789012")).toEqual({
      firstSeenAt: "2026-11-03T12:00:00.000Z",
      lastSeenAt: "2026-11-03T12:00:00.000Z",
    });

    await awol(aws, LATER).pageModel();
    expect(await storedState("123456789012")).toEqual({
      firstSeenAt: "2026-11-03T12:00:00.000Z",
      lastSeenAt: "2026-11-04T08:30:00.000Z",
    });
    expectOnlyJsonReads(aws);
  });

  it("keeps two accounts apart", async () => {
    const first = fakeAws({ [CALLER_IDENTITY]: SIGNED_IN });
    const second = fakeAws({ [CALLER_IDENTITY]: SIGNED_IN_ELSEWHERE });

    await awol(first, NOW).pageModel();
    expect(await awol(second, LATER).pageModel()).toEqual({ kind: "signed-in", accountId: "210987654321" });

    expect(await storedState("123456789012")).toEqual({
      firstSeenAt: "2026-11-03T12:00:00.000Z",
      lastSeenAt: "2026-11-03T12:00:00.000Z",
    });
    expect(await storedState("210987654321")).toEqual({
      firstSeenAt: "2026-11-04T08:30:00.000Z",
      lastSeenAt: "2026-11-04T08:30:00.000Z",
    });
    expectOnlyJsonReads(first);
    expectOnlyJsonReads(second);
  });

  it("leaves the stored state untouched when credentials have expired", async () => {
    const signedIn = fakeAws({ [CALLER_IDENTITY]: SIGNED_IN });
    const expired = fakeAws({ [CALLER_IDENTITY]: { stderr: credentialErrors.ssoTokenExpired } });

    await awol(signedIn, NOW).pageModel();
    await awol(expired, LATER).pageModel();

    expect(await readdir(path.join(dir, "accounts"))).toEqual(["123456789012"]);
    expect(await storedState("123456789012")).toEqual({
      firstSeenAt: "2026-11-03T12:00:00.000Z",
      lastSeenAt: "2026-11-03T12:00:00.000Z",
    });
    expectOnlyJsonReads(signedIn);
    expectOnlyJsonReads(expired);
  });

  it("serialises changes, so none overwrites another", async () => {
    const aws = fakeAws({ [CALLER_IDENTITY]: SIGNED_IN });

    await Promise.all([awol(aws, NOW).pageModel(), awol(aws, LATER).pageModel()]);

    expect(await storedState("123456789012")).toEqual({
      firstSeenAt: "2026-11-03T12:00:00.000Z",
      lastSeenAt: "2026-11-04T08:30:00.000Z",
    });
    expectOnlyJsonReads(aws);
  });
});

const LIST_REGIONS = "account list-regions --output json";

// The regions of the recorded account with status ENABLED_BY_DEFAULT.
const ENABLED_REGIONS = [
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ca-central-1",
  "eu-central-1",
  "eu-north-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "sa-east-1",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
];

function describeDbInstancesIn(region: string) {
  return `rds describe-db-instances --region ${region} --output json`;
}

function describeDbClustersIn(region: string) {
  return `rds describe-db-clusters --region ${region} --output json`;
}

// AWS's lifecycle answers by Engine, recorded in eu-west-1 and replayed for
// every region.
const MAJOR_VERSIONS: Record<string, unknown> = {
  postgres: postgresMajorVersions,
  mysql: mysqlMajorVersions,
  mariadb: mariadbMajorVersions,
  "aurora-postgresql": auroraPostgresqlMajorVersions,
  "aurora-mysql": auroraMysqlMajorVersions,
};

function describeMajorVersionsIn(region: string, engine: string) {
  return `rds describe-db-major-engine-versions --region ${region} --engine ${engine} --output json`;
}

// The versions AWS offers by Engine, recorded in eu-west-1 and replayed for
// every region.
const ENGINE_VERSIONS: Record<string, unknown> = {
  postgres: postgresEngineVersions,
  mysql: mysqlEngineVersions,
  mariadb: mariadbEngineVersions,
  "aurora-postgresql": auroraPostgresqlEngineVersions,
  "aurora-mysql": auroraMysqlEngineVersions,
};

function describeEngineVersionsIn(region: string, engine: string) {
  return `rds describe-db-engine-versions --region ${region} --engine ${engine} --output json`;
}

type DbInstance = Omit<(typeof describeDbInstances.DBInstances)[number], "EngineLifecycleSupport"> & {
  DBClusterIdentifier?: string;
  EngineLifecycleSupport?: string;
};

// The recorded instance db-5, PostgreSQL 17.9, given another identifier and
// the fields in `changes`, the way a second instance would differ.
function instance(identifier: string, changes: Partial<DbInstance> = {}): DbInstance {
  return { ...describeDbInstances.DBInstances[4]!, DBInstanceIdentifier: identifier, ...changes };
}

type DbCluster = { DBClusterIdentifier: string; Engine: string; EngineVersion: string; EngineLifecycleSupport?: string };

const CLUSTERS: DbCluster[] = describeDbClusters.DBClusters;

// The hand-written cluster `identifier`, with the fields in `changes`.
function cluster(identifier: string, changes: Partial<DbCluster> = {}): DbCluster {
  return { ...CLUSTERS.find(({ DBClusterIdentifier }) => DBClusterIdentifier === identifier)!, ...changes };
}

type ReplicationGroup = { ReplicationGroupId: string; MemberClusters: string[]; Engine: string };

type CacheCluster = { CacheClusterId: string; Engine: string; EngineVersion: string; ReplicationGroupId?: string };

type ServerlessCache = { ServerlessCacheName: string; Engine: string; MajorEngineVersion: string; FullEngineVersion: string };

const REPLICATION_GROUPS: ReplicationGroup[] = describeReplicationGroups.ReplicationGroups;

const CACHE_CLUSTERS: CacheCluster[] = describeCacheClusters.CacheClusters;

const SERVERLESS_CACHES: ServerlessCache[] = describeServerlessCaches.ServerlessCaches;

// The recorded replication group `identifier`, and its recorded member cache
// clusters, with the fields in `changes` on each member.
function replicationGroup(identifier: string, changes: Partial<CacheCluster> = {}): { group: ReplicationGroup; members: CacheCluster[] } {
  return {
    group: REPLICATION_GROUPS.find(({ ReplicationGroupId }) => ReplicationGroupId === identifier)!,
    members: CACHE_CLUSTERS.filter(({ ReplicationGroupId }) => ReplicationGroupId === identifier).map((member) => ({ ...member, ...changes })),
  };
}

// The recorded standalone cache cluster cache-1, Redis OSS 5.0.6, given
// another identifier and the fields in `changes`.
function cacheCluster(identifier: string, changes: Partial<CacheCluster> = {}): CacheCluster {
  return { ...CACHE_CLUSTERS.find(({ CacheClusterId }) => CacheClusterId === "cache-1")!, CacheClusterId: identifier, ...changes };
}

// The hand-written Serverless cache `identifier`.
function serverlessCache(identifier: string): ServerlessCache {
  return SERVERLESS_CACHES.find(({ ServerlessCacheName }) => ServerlessCacheName === identifier)!;
}

function describeReplicationGroupsIn(region: string) {
  return `elasticache describe-replication-groups --region ${region} --output json`;
}

function describeCacheClustersIn(region: string) {
  return `elasticache describe-cache-clusters --region ${region} --output json`;
}

function describeServerlessCachesIn(region: string) {
  return `elasticache describe-serverless-caches --region ${region} --output json`;
}

// The versions AWS offers by ElastiCache Engine, recorded in eu-west-1 and
// replayed for every region.
const CACHE_ENGINE_VERSIONS: Record<string, unknown> = { redis: redisCacheEngineVersions };

function describeCacheEngineVersionsIn(region: string, engine: string) {
  return `elasticache describe-cache-engine-versions --region ${region} --engine ${engine} --output json`;
}

type Domain = { DomainName: string; EngineVersion: string };

const DOMAINS: Domain[] = describeDomains.DomainStatusList;

// The hand-written domain `identifier`, with the fields in `changes`.
function domain(identifier: string, changes: Partial<Domain> = {}): Domain {
  return { ...DOMAINS.find(({ DomainName }) => DomainName === identifier)!, ...changes };
}

function listDomainNamesIn(region: string) {
  return `opensearch list-domain-names --region ${region} --output json`;
}

function describeDomainsIn(region: string, names: string[]) {
  return `opensearch describe-domains --region ${region} --domain-names ${names.join(" ")} --output json`;
}

function listVersionsIn(region: string) {
  return `opensearch list-versions --region ${region} --output json`;
}

// The answers for `domains` in `region`: their names with the engine each
// runs, and `describe-domains` for them five names at a time, the most AWS
// takes in one call.
function domainAnswers(region: string, domains: Domain[]): Record<string, Answer> {
  const answers: Record<string, Answer> = {
    [listDomainNamesIn(region)]: {
      stdout: JSON.stringify({
        DomainNames: domains.map(({ DomainName, EngineVersion }) => ({ DomainName, EngineType: EngineVersion.split("_")[0] })),
      }),
    },
  };
  for (let i = 0; i < domains.length; i += 5) {
    const batch = domains.slice(i, i + 5);
    answers[describeDomainsIn(region, batch.map(({ DomainName }) => DomainName))] = { stdout: JSON.stringify({ DomainStatusList: batch }) };
  }
  return answers;
}

type LambdaFunction = { FunctionName: string; Runtime?: string; PackageType: string; Version: string };

type Alias = { Name: string; FunctionVersion: string; RoutingConfig?: { AdditionalVersionWeights: Record<string, number> } };

const FUNCTIONS: LambdaFunction[] = listFunctions.Functions;

const ALIASES: Alias[] = listAliases.Aliases;

// The recorded function `identifier`'s $LATEST, with the fields in `changes`.
function lambdaFunction(identifier: string, changes: Partial<LambdaFunction> = {}): LambdaFunction {
  return { ...FUNCTIONS.find(({ FunctionName }) => FunctionName === identifier)!, ...changes };
}

// A Lambda function as an account has it: its $LATEST, its aliases, and its
// published versions as `get-function-configuration` gives each.
type DeployedFunction = { latest: LambdaFunction; aliases?: Alias[]; versions?: LambdaFunction[] };

function listFunctionsIn(region: string) {
  return `lambda list-functions --region ${region} --output json`;
}

function listAliasesIn(region: string, name: string) {
  return `lambda list-aliases --region ${region} --function-name ${name} --output json`;
}

function getFunctionConfigurationIn(region: string, name: string, version: string) {
  return `lambda get-function-configuration --region ${region} --function-name ${name} --qualifier ${version} --output json`;
}

// The answers for `functions` in `region`: each one's $LATEST, its aliases,
// and each of its published versions.
function functionAnswers(region: string, functions: DeployedFunction[]): Record<string, Answer> {
  const answers: Record<string, Answer> = {
    [listFunctionsIn(region)]: { stdout: JSON.stringify({ Functions: functions.map(({ latest }) => latest) }) },
  };
  for (const { latest, aliases = [], versions = [] } of functions) {
    answers[listAliasesIn(region, latest.FunctionName)] = { stdout: JSON.stringify({ Aliases: aliases }) };
    for (const version of versions) {
      answers[getFunctionConfigurationIn(region, latest.FunctionName, version.Version)] = { stdout: JSON.stringify(version) };
    }
  }
  return answers;
}

type AccountContents = {
  regions?: { RegionName: string; RegionOptStatus: string }[];
  instances?: Record<string, DbInstance[]>;
  clusters?: Record<string, DbCluster[]>;
  majorVersions?: Record<string, unknown>;
  engineVersions?: Record<string, unknown>;
  replicationGroups?: Record<string, ReplicationGroup[]>;
  cacheClusters?: Record<string, CacheCluster[]>;
  serverlessCaches?: Record<string, ServerlessCache[]>;
  domains?: Record<string, Domain[]>;
  functions?: Record<string, DeployedFunction[]>;
  unmonitored?: Record<string, Partial<Record<UnmonitoredCall, unknown>>>;
};

// The calls Discovery counts the services awol does not monitor with, by
// the argv in front of `--region`, and what each answers with no resources.
const UNMONITORED_CALLS = {
  "eks list-clusters": { clusters: [] },
  "kafka list-clusters-v2": { ClusterInfoList: [] },
  "mq list-brokers": { BrokerSummaries: [] },
  "memorydb describe-clusters": { Clusters: [] },
  "elasticbeanstalk describe-environments": { Environments: [] },
  "ec2 describe-instances": { Reservations: [] },
};

type UnmonitoredCall = keyof typeof UNMONITORED_CALLS;

// The hand-written answer of each call for the services awol does not
// monitor.
const UNMONITORED: Record<UnmonitoredCall, unknown> = {
  "eks list-clusters": eksListClusters,
  "kafka list-clusters-v2": kafkaListClusters,
  "mq list-brokers": mqListBrokers,
  "memorydb describe-clusters": memorydbDescribeClusters,
  "elasticbeanstalk describe-environments": elasticBeanstalkEnvironments,
  "ec2 describe-instances": ec2DescribeInstances,
};

function unmonitoredIn(region: string, call: UnmonitoredCall) {
  // Elastic Beanstalk lists deleted environments unless told not to.
  const options = call === "elasticbeanstalk describe-environments" ? " --no-include-deleted" : "";
  return `${call} --region ${region}${options} --output json`;
}

// The recorded account, signed in: its regions, its RDS instances and DB
// clusters, its ElastiCache replication groups, cache clusters and
// Serverless caches, its OpenSearch domains and its Lambda functions by
// region, where every enabled region not given has none, AWS's RDS
// lifecycles and offered versions by Engine in each region, the recorded ones
// unless given, and the recorded ElastiCache and OpenSearch offered versions.
// A region with no answer fails the Scan.
function account(contents: AccountContents = {}) {
  return fakeAws(accountAnswers(contents));
}

function accountAnswers({
  regions = listRegions.Regions,
  instances = { "eu-west-1": describeDbInstances.DBInstances },
  clusters = {},
  majorVersions = MAJOR_VERSIONS,
  engineVersions = ENGINE_VERSIONS,
  replicationGroups = {},
  cacheClusters = {},
  serverlessCaches = {},
  domains = {},
  functions = {},
  unmonitored = {},
}: AccountContents = {}): Record<string, Answer> {
  const answers: Record<string, Answer> = {
    [CALLER_IDENTITY]: SIGNED_IN,
    [LIST_REGIONS]: { stdout: JSON.stringify({ Regions: regions }) },
  };
  for (const region of [
    ...ENABLED_REGIONS,
    ...Object.keys(instances),
    ...Object.keys(clusters),
    ...Object.keys(replicationGroups),
    ...Object.keys(cacheClusters),
    ...Object.keys(serverlessCaches),
    ...Object.keys(domains),
    ...Object.keys(functions),
    ...Object.keys(unmonitored),
  ]) {
    answers[describeDbInstancesIn(region)] = { stdout: JSON.stringify({ DBInstances: instances[region] ?? [] }) };
    answers[describeDbClustersIn(region)] = { stdout: JSON.stringify({ DBClusters: clusters[region] ?? [] }) };
    for (const [engine, answer] of Object.entries(majorVersions)) {
      answers[describeMajorVersionsIn(region, engine)] = { stdout: JSON.stringify(answer) };
    }
    for (const [engine, answer] of Object.entries(engineVersions)) {
      answers[describeEngineVersionsIn(region, engine)] = { stdout: JSON.stringify(answer) };
    }
    answers[describeReplicationGroupsIn(region)] = { stdout: JSON.stringify({ ReplicationGroups: replicationGroups[region] ?? [] }) };
    answers[describeCacheClustersIn(region)] = { stdout: JSON.stringify({ CacheClusters: cacheClusters[region] ?? [] }) };
    answers[describeServerlessCachesIn(region)] = { stdout: JSON.stringify({ ServerlessCaches: serverlessCaches[region] ?? [] }) };
    for (const [engine, answer] of Object.entries(CACHE_ENGINE_VERSIONS)) {
      answers[describeCacheEngineVersionsIn(region, engine)] = { stdout: JSON.stringify(answer) };
    }
    Object.assign(answers, domainAnswers(region, domains[region] ?? []));
    answers[listVersionsIn(region)] = { stdout: JSON.stringify(openSearchVersions) };
    Object.assign(answers, functionAnswers(region, functions[region] ?? []));
    for (const [call, none] of Object.entries(UNMONITORED_CALLS) as [UnmonitoredCall, unknown][]) {
      answers[unmonitoredIn(region, call)] = { stdout: JSON.stringify(unmonitored[region]?.[call] ?? none) };
    }
  }
  return answers;
}

// The page's one Component after a Scan on `now` of an account with only
// `changes` applied to the recorded instance db-5, and AWS's RDS lifecycles
// and offered versions by Engine, the recorded ones unless given, read with
// endoflife.date's recorded products unless given; and the fake runner, to
// check last.
async function scannedComponent(
  changes: Partial<DbInstance>,
  {
    now = NOW,
    majorVersions = MAJOR_VERSIONS,
    engineVersions = ENGINE_VERSIONS,
    endOfLife = fakeEndOfLife(),
  }: { now?: Date; majorVersions?: Record<string, unknown>; engineVersions?: Record<string, unknown>; endOfLife?: EndOfLifeFetcher } = {},
) {
  const aws = account({ instances: { "eu-west-1": [instance("db-6", changes)] }, majorVersions, engineVersions });
  await scanAll(aws, now, endOfLife);
  const model = await awol(aws, now, endOfLife).pageModel();
  if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
  return { component: model.lastScan!.components[0]!, aws };
}

describe("a Scan", () => {
  it("shows every RDS instance of the account with its Status, most urgent first", async () => {
    const aws = account();

    await scanAll(aws);

    expect(await awol(aws).pageModel()).toEqual({
      kind: "signed-in",
      accountId: "123456789012",
      monitoredServices: ["RDS", "Aurora", "ElastiCache Redis OSS", "OpenSearch Service", "Lambda"],
      lastScan: {
        ranAt: "2026-11-03T12:00:00.000Z",
        counts: { AWOL: 1, "Falling behind": 2, Current: 2, Untracked: 0 },
        components: [
          {
            service: "RDS",
            product: "RDS MySQL",
            region: "eu-west-1",
            identifier: "db-1",
            version: "8.0.46-rds.20260624",
            extendedSupport: "Extended Support",
            releaseCycle: "8.0.46",
            status: "AWOL",
            cycleReleaseDate: "2026-04-21",
            activeSupportEnd: "2026-07-31",
            endOfLife: "2026-07-31",
            extendedSupportEnd: "2029-07-31",
            sources: {
              aws: { endOfLife: "2026-07-31", extendedSupportEnd: "2029-07-31" },
              "endoflife.date": { endOfLife: "2026-07-31", extendedSupportEnd: "2029-07-31" },
            },
            datesDisagree: false,
            drift: {
              latestPatch: { kind: "none" },
              newestCycle: { kind: "behind", version: "8.4" },
              newestOffered: { kind: "behind", version: "8.4.11" },
            },
          },
          {
            service: "RDS",
            product: "RDS PostgreSQL",
            region: "eu-west-1",
            identifier: "db-2",
            version: "14.19",
            extendedSupport: "Extended Support",
            releaseCycle: "14",
            status: "Falling behind",
            cycleReleaseDate: "2022-02-03",
            endOfLife: "2027-02-28",
            extendedSupportEnd: "2030-02-28",
            sources: {
              aws: { endOfLife: "2027-02-28", extendedSupportEnd: "2030-02-28" },
              "endoflife.date": { endOfLife: "2027-02-28", extendedSupportEnd: "2030-02-28" },
            },
            datesDisagree: false,
            drift: {
              latestPatch: { kind: "behind", version: "14.24" },
              newestCycle: { kind: "behind", version: "18" },
              newestOffered: { kind: "behind", version: "18.6" },
            },
          },
          {
            service: "RDS",
            product: "RDS PostgreSQL",
            region: "eu-west-1",
            identifier: "db-3",
            version: "14.22",
            extendedSupport: "auto-upgrade at End of life",
            releaseCycle: "14",
            status: "Falling behind",
            cycleReleaseDate: "2022-02-03",
            endOfLife: "2027-02-28",
            extendedSupportEnd: "2030-02-28",
            sources: {
              aws: { endOfLife: "2027-02-28", extendedSupportEnd: "2030-02-28" },
              "endoflife.date": { endOfLife: "2027-02-28", extendedSupportEnd: "2030-02-28" },
            },
            datesDisagree: false,
            drift: {
              latestPatch: { kind: "behind", version: "14.24" },
              newestCycle: { kind: "behind", version: "18" },
              newestOffered: { kind: "behind", version: "18.6" },
            },
          },
          {
            service: "RDS",
            product: "RDS PostgreSQL",
            region: "eu-west-1",
            identifier: "db-4",
            version: "16.13",
            extendedSupport: "Extended Support",
            releaseCycle: "16",
            status: "Current",
            cycleReleaseDate: "2023-11-17",
            endOfLife: "2029-02-28",
            extendedSupportEnd: "2032-02-29",
            sources: {
              aws: { endOfLife: "2029-02-28", extendedSupportEnd: "2032-02-29" },
              "endoflife.date": { endOfLife: "2029-02-28", extendedSupportEnd: "2032-02-29" },
            },
            datesDisagree: false,
            drift: {
              latestPatch: { kind: "behind", version: "16.15" },
              newestCycle: { kind: "behind", version: "18" },
              newestOffered: { kind: "behind", version: "18.6" },
            },
          },
          {
            service: "RDS",
            product: "RDS PostgreSQL",
            region: "eu-west-1",
            identifier: "db-5",
            version: "17.9",
            extendedSupport: "Extended Support",
            releaseCycle: "17",
            status: "Current",
            cycleReleaseDate: "2024-11-14",
            endOfLife: "2030-02-28",
            extendedSupportEnd: "2033-02-28",
            sources: {
              aws: { endOfLife: "2030-02-28", extendedSupportEnd: "2033-02-28" },
              "endoflife.date": { endOfLife: "2030-02-28", extendedSupportEnd: "2033-02-28" },
            },
            datesDisagree: false,
            drift: {
              latestPatch: { kind: "behind", version: "17.11" },
              newestCycle: { kind: "behind", version: "18" },
              newestOffered: { kind: "behind", version: "18.6" },
            },
          },
        ],
        failedParts: [],
        unmonitoredServices: [],
      },
    });
    expectOnlyJsonReads(aws);
  });

  // The page's Components, each as its identifier, region and Status.
  async function statuses(aws: AwsRunner, now = NOW) {
    const model = await awol(aws, now).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return model.lastScan?.components.map(({ identifier, region, status }) => ({ identifier, region, status }));
  }

  it("reads the regions enabled by opting in as well as those enabled by default, and no others", async () => {
    const regions = listRegions.Regions.map((region) =>
      region.RegionName === "eu-south-2"
        ? { ...region, RegionOptStatus: "ENABLED" }
        : region.RegionName === "me-central-1"
          ? { ...region, RegionOptStatus: "ENABLING" }
          : region.RegionName === "il-central-1"
            ? { ...region, RegionOptStatus: "DISABLING" }
            : region,
    );
    const aws = account({ regions, instances: { "eu-south-2": [instance("db-6")], "us-west-2": [instance("db-7")] } });

    await scanAll(aws);

    expect(await statuses(aws)).toEqual([
      { identifier: "db-6", region: "eu-south-2", status: "Current" },
      { identifier: "db-7", region: "us-west-2", status: "Current" },
    ]);
    const described = aws.calls.filter(([, subcommand]) => subcommand === "describe-db-instances").map((argv) => argv[3]);
    expect(described.sort()).toEqual([...ENABLED_REGIONS, "eu-south-2"].sort());
    expectOnlyJsonReads(aws);
  });

  it("reads regions in parallel, at most 8 at once", async () => {
    const recorded = account();
    let inFlight = 0;
    let mostInFlight = 0;
    const aws = Object.assign(
      async (argv: string[]) => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return recorded(argv);
      },
      { calls: recorded.calls },
    );

    await scanAll(aws);

    expect(mostInFlight).toBeGreaterThan(1);
    expect(mostInFlight).toBeLessThanOrEqual(8);
    expectOnlyJsonReads(aws);
  });

  it("leaves out an instance that belongs to a DB cluster, which is its cluster's", async () => {
    const aws = account({
      instances: {
        "eu-west-1": [
          instance("db-6"),
          instance("cluster-1-instance-1", { DBClusterIdentifier: "cluster-1" }),
          instance("cluster-2-instance-1", { Engine: "aurora-postgresql", DBClusterIdentifier: "cluster-2" }),
        ],
      },
    });

    await scanAll(aws);

    expect(await statuses(aws)).toEqual([{ identifier: "db-6", region: "eu-west-1", status: "Current" }]);
    expectOnlyJsonReads(aws);
  });

  it("leaves out Oracle and SQL Server instances", async () => {
    const aws = account({
      instances: {
        "eu-west-1": [
          instance("db-6"),
          instance("oracle-1", { Engine: "oracle-ee", EngineVersion: "19.0.0.0.ru-2026-07.rur-2026-07.r1" }),
          instance("sqlserver-1", { Engine: "sqlserver-se", EngineVersion: "16.00.4215.2.v1" }),
        ],
      },
    });

    await scanAll(aws);

    expect(await statuses(aws)).toEqual([{ identifier: "db-6", region: "eu-west-1", status: "Current" }]);
    expectOnlyJsonReads(aws);
  });

  it.each([
    // PostgreSQL by major, except the 9.6 cycle.
    ["postgres", "13.7", "RDS PostgreSQL", "13", "AWOL"],
    ["postgres", "18.1", "RDS PostgreSQL", "18", "Current"],
    ["postgres", "9.6.24", "RDS PostgreSQL", "9.6", "AWOL"],
    // MySQL by exact minor cycle first, then x.y.
    ["mysql", "8.4.7", "RDS MySQL", "8.4.7", "Current"],
    ["mysql", "8.4.11", "RDS MySQL", "8.4", "Current"],
    ["mysql", "8.0.35", "RDS MySQL", "8.0", "AWOL"],
    ["mysql", "5.7.44-rds.20240529", "RDS MySQL", "5.7", "AWOL"],
    // MariaDB by x.y.
    ["mariadb", "10.11.15", "RDS MariaDB", "10.11", "Current"],
    ["mariadb", "10.6.22", "RDS MariaDB", "10.6", "Falling behind"],
    ["mariadb", "10.5.29", "RDS MariaDB", "10.5", "AWOL"],
  ])("matches %s %s to %s Release Cycle %s", async (engine, version, product, releaseCycle, status) => {
    const aws = account({ instances: { "eu-west-1": [instance("db-6", { Engine: engine, EngineVersion: version })] } });

    await scanAll(aws);

    const model = await awol(aws).pageModel();
    expect(model).toMatchObject({ lastScan: { components: [{ product, version, releaseCycle, status }] } });
    expectOnlyJsonReads(aws);
  });

  it.each([
    ["postgres", "19.1", "RDS PostgreSQL"],
    ["mysql", "9.4.0", "RDS MySQL"],
    ["mariadb", "12.4.1", "RDS MariaDB"],
  ])("shows %s %s, which matches no Release Cycle, as Untracked", async (engine, version, product) => {
    const aws = account({ instances: { "eu-west-1": [instance("db-6", { Engine: engine, EngineVersion: version })] } });

    await scanAll(aws);

    expect(await awol(aws).pageModel()).toMatchObject({
      lastScan: {
        counts: { AWOL: 0, "Falling behind": 0, Current: 0, Untracked: 1 },
        components: [{ product, version, releaseCycle: undefined, status: "Untracked", endOfLife: undefined }],
      },
    });
    expectOnlyJsonReads(aws);
  });

  it.each([
    // PostgreSQL 14 reaches End of life on 2027-02-28, 180 days after 2026-09-01.
    ["postgres", "14.22", "2027-02-28", "AWOL"],
    ["postgres", "14.22", "2027-02-27", "Falling behind"],
    ["postgres", "14.22", "2026-09-01", "Falling behind"],
    ["postgres", "14.22", "2026-08-31", "Current"],
    // MySQL 8.4.7 leaves Active support on 2026-11-30 and reaches End of life
    // on 2029-07-31.
    ["mysql", "8.4.7", "2026-11-30", "Falling behind"],
    ["mysql", "8.4.7", "2026-11-29", "Current"],
    // PostgreSQL 13 is on Extended Support until 2029-02-28.
    ["postgres", "13.22", "2027-01-01", "AWOL"],
  ])("shows %s %s on %s as %s", async (engine, version, date, status) => {
    const aws = account({ instances: { "eu-west-1": [instance("db-6", { Engine: engine, EngineVersion: version })] } });
    const now = new Date(`${date}T12:00:00Z`);

    await scanAll(aws, now);

    expect(await statuses(aws, now)).toEqual([{ identifier: "db-6", region: "eu-west-1", status }]);
    expectOnlyJsonReads(aws);
  });

  it("shows a Component whose Release Cycle has no End of life announced as Current, with no End of life", async () => {
    // The recorded PostgreSQL product and AWS lifecycles, with End of life and
    // Extended Support not yet announced for 18, as for a newly released
    // cycle.
    const unannounced = structuredClone(rdsPostgresql);
    Object.assign(unannounced.result.releases[0]!, { isEol: false, eolFrom: null, isEoes: false, eoesFrom: null });
    const endOfLife = fakeEndOfLife({
      ...RECORDED_PRODUCTS,
      "amazon-rds-postgresql": { etag: '"unannounced"', body: unannounced },
    });
    const awsUnannounced = structuredClone(postgresMajorVersions);
    awsUnannounced.DBMajorEngineVersions.find(({ MajorEngineVersion }) => MajorEngineVersion === "18")!.SupportedEngineLifecycles = [];
    const aws = account({
      instances: { "eu-west-1": [instance("db-6", { EngineVersion: "18.1" })] },
      majorVersions: { ...MAJOR_VERSIONS, postgres: awsUnannounced },
    });
    const farFuture = new Date("2040-01-01T12:00:00Z");

    await scanAll(aws, farFuture, endOfLife);

    const model = await awol(aws, farFuture, endOfLife).pageModel();
    expect(model).toMatchObject({ lastScan: { components: [{ releaseCycle: "18", status: "Current" }] } });
    expect(model.kind === "signed-in" && model.lastScan?.components[0]).toEqual({
      service: "RDS",
      product: "RDS PostgreSQL",
      region: "eu-west-1",
      identifier: "db-6",
      version: "18.1",
      extendedSupport: "Extended Support",
      releaseCycle: "18",
      status: "Current",
      cycleReleaseDate: "2025-11-14",
      sources: { aws: {}, "endoflife.date": {} },
      datesDisagree: false,
      drift: {
        latestPatch: { kind: "behind", version: "18.6" },
        newestCycle: { kind: "none" },
        newestOffered: { kind: "behind", version: "18.6" },
      },
    });
    expectOnlyJsonReads(aws);
  });

  it("sorts by Status, then by soonest End of life", async () => {
    const aws = account({
      instances: {
        "eu-west-1": [
          instance("untracked", { EngineVersion: "19.1" }),
          instance("current-2030", { EngineVersion: "17.9" }),
          instance("current-2029", { Engine: "mariadb", EngineVersion: "11.4.8" }),
          instance("awol-2026-07", { Engine: "mysql", EngineVersion: "8.0.46-rds.20260624" }),
          instance("falling-behind", { EngineVersion: "14.22" }),
          instance("awol-2025", { EngineVersion: "12.22" }),
          instance("awol-2026-02", { EngineVersion: "13.22" }),
        ],
      },
    });

    await scanAll(aws);

    expect((await statuses(aws))?.map(({ identifier }) => identifier)).toEqual([
      "awol-2025",
      "awol-2026-02",
      "awol-2026-07",
      "falling-behind",
      "current-2029",
      "current-2030",
      "untracked",
    ]);
    expect(await awol(aws).pageModel()).toMatchObject({
      lastScan: { counts: { AWOL: 3, "Falling behind": 1, Current: 2, Untracked: 1 } },
    });
    expectOnlyJsonReads(aws);
  });

  it("asks endoflife.date only for what changed since the last Scan, sharing what it got across accounts", async () => {
    const endOfLife = fakeEndOfLife();
    const first = account();
    const second = fakeAws({ ...accountAnswers(), [CALLER_IDENTITY]: SIGNED_IN_ELSEWHERE });

    await scanAll(first, NOW, endOfLife);
    const firstCalls = endOfLife.calls.splice(0);
    await scanAll(second, NOW, endOfLife);

    const byUrl = (a: { url: string }, b: { url: string }) => a.url.localeCompare(b.url);
    expect(firstCalls.sort(byUrl)).toEqual([
      { url: "https://endoflife.date/api/v1/products/amazon-rds-mysql" },
      { url: "https://endoflife.date/api/v1/products/amazon-rds-postgresql" },
    ]);
    expect(endOfLife.calls.sort(byUrl)).toEqual([
      { url: "https://endoflife.date/api/v1/products/amazon-rds-mysql", etag: '"8274b83b7bb3c944a2eed9fe4d991165-ssl"' },
      { url: "https://endoflife.date/api/v1/products/amazon-rds-postgresql", etag: '"8657de974096f1d9de7976eb94ccaf05-ssl"' },
    ]);
    // Every endoflife.date answer to the second account was a 304, so its
    // Statuses come from the copy kept from the first.
    expect(await statuses(second)).toEqual(await statuses(first));
    expectOnlyJsonReads(first);
    expectOnlyJsonReads(second);
  });

  it("asks to log in again when credentials expire, keeping the last Scan", async () => {
    const signedIn = account();
    const expired = fakeAws({ [CALLER_IDENTITY]: { stderr: credentialErrors.ssoTokenExpired } });
    await scanAll(signedIn);

    expect(await awol(expired, new Date("2026-11-04T08:30:00Z")).scan()).toEqual({
      kind: "login-needed",
      reason: credentialErrors.ssoTokenExpired.trim(),
    });

    expect(await awol(signedIn).pageModel()).toMatchObject({
      lastScan: { ranAt: "2026-11-03T12:00:00.000Z", counts: { AWOL: 1, "Falling behind": 2, Current: 2, Untracked: 0 } },
    });
    expectOnlyJsonReads(signedIn);
    expectOnlyJsonReads(expired);
  });
});

describe("a Scan that fails in part", () => {
  const LATER = new Date("2026-11-04T08:30:00Z");

  // The page's last Scan on `now`, read with endoflife.date's recorded
  // products unless given.
  async function lastScan(aws: AwsRunner, now = LATER, endOfLife: EndOfLifeFetcher = fakeEndOfLife()) {
    const model = await awol(aws, now, endOfLife).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return model.lastScan!;
  }

  // Each Component as its identifier, version and whether it is Stale.
  function rows(scan: { components: { identifier: string; version?: string; stale?: { lastReadAt: string } }[] }) {
    return scan.components.map(({ identifier, version, stale }) => ({ identifier, version, stale }));
  }

  it.each([
    ["AccessDenied", awsErrors.accessDenied],
    ["throttling", awsErrors.throttling],
    ["the service not available in the region", awsErrors.notAvailable],
  ])("keeps a service's previous result in a region it fails in with %s, Stale since its last successful read", async (_, stderr) => {
    const before = account({
      instances: { "eu-west-1": [instance("db-6")] },
      functions: { "eu-west-1": [{ latest: lambdaFunction("function-6") }] },
    });
    await scanAll(before, NOW);
    // db-6 has been replaced by db-7 and function-6 moved to python3.13, but
    // RDS fails in eu-west-1.
    const after = fakeAws({
      ...accountAnswers({
        instances: { "eu-west-1": [instance("db-7")] },
        functions: { "eu-west-1": [{ latest: lambdaFunction("function-6", { Runtime: "python3.13" }) }] },
      }),
      [describeDbInstancesIn("eu-west-1")]: { stderr },
    });

    await scanAll(after, LATER);

    const scan = await lastScan(after);
    expect(scan.ranAt).toBe("2026-11-04T08:30:00.000Z");
    expect(rows(scan)).toEqual([
      { identifier: "function-6:$LATEST", version: "python3.13", stale: undefined },
      { identifier: "db-6", version: "17.9", stale: { lastReadAt: "2026-11-03T12:00:00.000Z" } },
    ]);
    expect(scan.failedParts).toEqual([
      {
        part: { kind: "service", service: "RDS", region: "eu-west-1" },
        error: stderr.trim(),
        lastReadAt: "2026-11-03T12:00:00.000Z",
      },
    ]);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });

  // endoflife.date failing for `product` with `failure`, an HTTP status or
  // unreachable, and replaying the recorded products otherwise.
  function failingEndOfLife(product: string, failure: number | "unreachable"): EndOfLifeFetcher {
    const recorded = fakeEndOfLife();
    return async (url, etag) => {
      if (url !== `https://endoflife.date/api/v1/products/${product}`) return recorded(url, etag);
      if (failure === "unreachable") throw new TypeError("fetch failed");
      return { status: failure, body: "" };
    };
  }

  it.each([
    [429,"endoflife.date answered 429 for amazon-rds-postgresql"],
    [502, "endoflife.date answered 502 for amazon-rds-postgresql"],
    [503, "endoflife.date answered 503 for amazon-rds-postgresql"],
    ["unreachable", "endoflife.date could not be reached for amazon-rds-postgresql: fetch failed"],
  ] as const)(
    "uses the cached copy of a product endoflife.date fails for with %s, Stale since its last successful read",
    async (failure, error) => {
      const aws = account({ instances: { "eu-west-1": [instance("db-6"), instance("db-7", { Engine: "mysql", EngineVersion: "8.4.7" })] } });
      await scanAll(aws, NOW);
      const failing = failingEndOfLife("amazon-rds-postgresql", failure);

      await scanAll(aws, LATER, failing);

      const scan = await lastScan(aws, LATER, failing);
      expect(scan.components.map(({ identifier, releaseCycle, status, stale }) => ({ identifier, releaseCycle, status, stale }))).toEqual([
        { identifier: "db-7", releaseCycle: "8.4.7", status: "Current", stale: undefined },
        { identifier: "db-6", releaseCycle: "17", status: "Current", stale: { lastReadAt: "2026-11-03T12:00:00.000Z" } },
      ]);
      expect(scan.failedParts).toEqual([
        { part: { kind: "endoflife.date", product: "amazon-rds-postgresql" }, error, lastReadAt: "2026-11-03T12:00:00.000Z" },
      ]);
      expectOnlyJsonReads(aws);
    },
  );

  it("uses a copy kept before awol recorded when it read endoflife.date, Stale since the copy was written", async () => {
    const aws = account({ instances: { "eu-west-1": [instance("db-6")] } });
    // The copy as awol kept it before: its ETag and body only.
    const cachePath = path.join(dir, "endoflife", "amazon-rds-postgresql.json");
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ etag: RECORDED_PRODUCTS["amazon-rds-postgresql"]!.etag, body: JSON.stringify(rdsPostgresql) }));
    await utimes(cachePath, NOW, NOW);
    const failing = failingEndOfLife("amazon-rds-postgresql", 503);

    await scanAll(aws, LATER, failing);

    const scan = await lastScan(aws, LATER, failing);
    expect(scan.components).toMatchObject([
      { identifier: "db-6", releaseCycle: "17", status: "Current", stale: { lastReadAt: "2026-11-03T12:00:00.000Z" } },
    ]);
    expect(scan.failedParts).toEqual([
      {
        part: { kind: "endoflife.date", product: "amazon-rds-postgresql" },
        error: "endoflife.date answered 503 for amazon-rds-postgresql",
        lastReadAt: "2026-11-03T12:00:00.000Z",
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows the error of a service never read successfully in a region, instead of its Components", async () => {
    const aws = fakeAws({
      ...accountAnswers({
        instances: { "eu-west-1": [instance("db-6")] },
        functions: { "eu-west-1": [{ latest: lambdaFunction("function-6") }] },
      }),
      [describeDbInstancesIn("eu-west-1")]: { stderr: awsErrors.accessDenied },
    });

    await scanAll(aws, NOW);

    const scan = await lastScan(aws, NOW);
    expect(rows(scan)).toEqual([{ identifier: "function-6:$LATEST", version: "python3.12", stale: undefined }]);
    expect(scan.failedParts).toEqual([
      { part: { kind: "service", service: "RDS", region: "eu-west-1" }, error: awsErrors.accessDenied.trim() },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows the Components of a product endoflife.date has never given as Untracked, with its error", async () => {
    const aws = account({ instances: { "eu-west-1": [instance("db-6")] } });
    const failing = failingEndOfLife("amazon-rds-postgresql", 503);

    await scanAll(aws, NOW, failing);

    const scan = await lastScan(aws, NOW, failing);
    expect(scan.components).toMatchObject([{ identifier: "db-6", releaseCycle: undefined, status: "Untracked" }]);
    expect(scan.components[0]!.stale).toBeUndefined();
    expect(scan.failedParts).toEqual([
      { part: { kind: "endoflife.date", product: "amazon-rds-postgresql" }, error: "endoflife.date answered 503 for amazon-rds-postgresql" },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("reads the previous Scan's regions when the account's regions cannot be read, Stale since their last successful read", async () => {
    const regions = listRegions.Regions.map((region) => (region.RegionName === "eu-south-2" ? { ...region, RegionOptStatus: "ENABLED" } : region));
    const before = account({ regions, instances: { "eu-south-2": [instance("db-6")] } });
    await scanAll(before, NOW);
    // db-6 has been replaced by db-7, but the account's regions cannot be
    // read.
    const after = fakeAws({
      ...accountAnswers({ instances: { "eu-south-2": [instance("db-7")] } }),
      [LIST_REGIONS]: { stderr: awsErrors.listRegionsAccessDenied },
    });

    await scanAll(after, LATER);

    const scan = await lastScan(after);
    expect(rows(scan)).toEqual([{ identifier: "db-7", version: "17.9", stale: undefined }]);
    expect(scan.failedParts).toEqual([
      { part: { kind: "regions" }, error: awsErrors.listRegionsAccessDenied.trim(), lastReadAt: "2026-11-03T12:00:00.000Z" },
    ]);
    const described = after.calls.filter(([, subcommand]) => subcommand === "describe-db-instances").map((argv) => argv[3]);
    expect(described.sort()).toEqual([...ENABLED_REGIONS, "eu-south-2"].sort());
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });

  it("reads no region, showing the error, when the account's regions have never been read successfully", async () => {
    const aws = fakeAws({ ...accountAnswers(), [LIST_REGIONS]: { stderr: awsErrors.listRegionsAccessDenied } });

    await scanAll(aws, NOW);

    // Once to choose the Monitored services, and once to Scan.
    expect(aws.calls.map(([service, subcommand]) => `${service} ${subcommand}`)).toEqual([
      "sts get-caller-identity",
      "sts get-caller-identity",
      "account list-regions",
    ]);
    const scan = await lastScan(aws, NOW);
    expect(scan.components).toEqual([]);
    expect(scan.failedParts).toEqual([{ part: { kind: "regions" }, error: awsErrors.listRegionsAccessDenied.trim() }]);
    expectOnlyJsonReads(aws);
  });

  it("asks to log in again when credentials expire part-way through a Scan, keeping every result of the last Scan", async () => {
    const before = account({ instances: { "eu-west-1": [instance("db-6")] } });
    await scanAll(before, NOW);
    const kept = await lastScan(before, NOW);
    // db-6 has been replaced by db-7, but credentials expire before RDS is
    // read in eu-west-1.
    const after = fakeAws({
      ...accountAnswers({ instances: { "eu-west-1": [instance("db-7")] } }),
      [describeDbInstancesIn("eu-west-1")]: { stderr: credentialErrors.expiredToken },
    });

    expect(await awol(after, LATER).scan()).toEqual({ kind: "login-needed", reason: credentialErrors.expiredToken.trim() });

    expect(await lastScan(before, NOW)).toEqual(kept);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });

  it("shows a Scan kept before awol kept Scans by part, and reads every part again on the next Scan", async () => {
    const aws = account({ instances: { "eu-west-1": [instance("db-6")] } });
    await scanAll(aws, NOW);
    const shown = await lastScan(aws, NOW);
    // The same Scan as awol kept it before: its Components only.
    await writeFile(
      path.join(dir, "accounts", "123456789012", "state.json"),
      JSON.stringify({
        lastScan: {
          ranAt: "2026-11-03T12:00:00.000Z",
          components: [
            {
              service: "RDS",
              product: "RDS PostgreSQL",
              region: "eu-west-1",
              identifier: "db-6",
              version: "17.9",
              extendedSupport: "Extended Support",
              awsLifecycle: { endOfLife: "2030-02-28", extendedSupportEnd: "2033-02-28" },
              releaseCycle: { name: "17", latest: "17.11", releaseDate: "2024-11-14", endOfLife: "2030-02-28", extendedSupportEnd: "2033-02-28" },
              drift: {
                latestPatch: { kind: "behind", version: "17.11" },
                newestCycle: { kind: "behind", version: "18" },
                newestOffered: { kind: "behind", version: "18.6" },
              },
            },
          ],
        },
      }),
    );

    expect(await lastScan(aws, NOW)).toEqual(shown);

    const failing = fakeAws({
      ...accountAnswers({ instances: { "eu-west-1": [instance("db-6")] } }),
      [describeDbInstancesIn("eu-west-1")]: { stderr: awsErrors.accessDenied },
    });
    await scanAll(failing, LATER);
    expect((await lastScan(failing)).components).toEqual([]);
    expectOnlyJsonReads(aws);
    expectOnlyJsonReads(failing);
  });
});

describe("AWS's support dates for RDS", () => {
  it.each([
    // AWS ends standard support for MariaDB 11.8 on 2030-06-30, endoflife.date
    // on 2028-06-30.
    ["11.8.3", "2028-07-01", "2030-06-30", "Current"],
    // AWS ends standard support for MariaDB 10.5 on 2026-02-28, endoflife.date
    // on 2026-08-31.
    ["10.5.29", "2026-04-01", "2026-02-28", "AWOL"],
  ])("decides Status with AWS's End of life over endoflife.date's: MariaDB %s on %s", async (version, date, endOfLife, status) => {
    const { component, aws } = await scannedComponent(
      { Engine: "mariadb", EngineVersion: version },
      { now: new Date(`${date}T12:00:00Z`) },
    );

    expect(component).toMatchObject({ endOfLife, status });
    expectOnlyJsonReads(aws);
  });

  it("shows both sources' dates, marking the row where they disagree", async () => {
    const { component, aws } = await scannedComponent({ Engine: "mariadb", EngineVersion: "11.8.3" });

    expect(component).toMatchObject({
      endOfLife: "2030-06-30",
      sources: { aws: { endOfLife: "2030-06-30" }, "endoflife.date": { endOfLife: "2028-06-30" } },
      datesDisagree: true,
    });
    expectOnlyJsonReads(aws);
  });

  it("shows AWS's end of Extended Support over endoflife.date's, marking the row", async () => {
    // The recorded MySQL lifecycles, with Extended Support for 8.0 ending a
    // year later than endoflife.date's 2029-07-31.
    const later = structuredClone(mysqlMajorVersions);
    later.DBMajorEngineVersions.find(({ MajorEngineVersion }) => MajorEngineVersion === "8.0")!.SupportedEngineLifecycles[1]!.LifecycleSupportEndDate =
      "2030-07-31T23:59:59.999000+00:00";

    const { component, aws } = await scannedComponent(
      { Engine: "mysql", EngineVersion: "8.0.46-rds.20260624" },
      { majorVersions: { ...MAJOR_VERSIONS, mysql: later } },
    );

    expect(component).toMatchObject({
      endOfLife: "2026-07-31",
      extendedSupportEnd: "2030-07-31",
      sources: {
        aws: { endOfLife: "2026-07-31", extendedSupportEnd: "2030-07-31" },
        "endoflife.date": { endOfLife: "2026-07-31", extendedSupportEnd: "2029-07-31" },
      },
      datesDisagree: true,
    });
    expectOnlyJsonReads(aws);
  });

  it("reads AWS's dates in each Component's own region", async () => {
    // The recorded PostgreSQL lifecycles, with standard support for 17 ending
    // a year later in us-west-2 only.
    const later = structuredClone(postgresMajorVersions);
    later.DBMajorEngineVersions.find(({ MajorEngineVersion }) => MajorEngineVersion === "17")!.SupportedEngineLifecycles[0]!.LifecycleSupportEndDate =
      "2031-02-28T23:59:59.999000+00:00";
    const instances = { "eu-west-1": [instance("db-6")], "us-west-2": [instance("db-7")] };
    const aws = fakeAws({
      ...accountAnswers({ instances }),
      [describeMajorVersionsIn("us-west-2", "postgres")]: { stdout: JSON.stringify(later) },
    });

    await scanAll(aws);

    const model = await awol(aws).pageModel();
    expect(model.kind === "signed-in" && model.lastScan?.components.map(({ identifier, endOfLife }) => ({ identifier, endOfLife }))).toEqual([
      { identifier: "db-6", endOfLife: "2030-02-28" },
      { identifier: "db-7", endOfLife: "2031-02-28" },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows MariaDB, which AWS gives standard support only, with no end of Extended Support and no setting", async () => {
    const { component, aws } = await scannedComponent({
      Engine: "mariadb",
      EngineVersion: "10.11.15",
      EngineLifecycleSupport: "open-source-rds-extended-support",
    });

    expect(component).toMatchObject({
      endOfLife: "2028-02-29",
      extendedSupportEnd: undefined,
      sources: { aws: { endOfLife: "2028-02-29" }, "endoflife.date": { endOfLife: "2028-02-29" } },
      datesDisagree: false,
    });
    expect(component.sources.aws.extendedSupportEnd).toBeUndefined();
    expect(component.extendedSupport).toBeUndefined();
    expectOnlyJsonReads(aws);
  });

  it.each([
    // AWS lists MariaDB 12.3 with no support dates.
    ["mariadb", "12.3.3", "2029-06-30", "Current"],
    // AWS no longer lists PostgreSQL 9.6.
    ["postgres", "9.6.24", "2022-04-30", "AWOL"],
  ])("decides Status with endoflife.date's End of life where AWS gives none: %s %s", async (engine, version, endOfLife, status) => {
    const { component, aws } = await scannedComponent({ Engine: engine, EngineVersion: version });

    expect(component).toMatchObject({
      endOfLife,
      status,
      sources: { "endoflife.date": { endOfLife } },
      datesDisagree: false,
    });
    expect(component.sources.aws.endOfLife).toBeUndefined();
    expectOnlyJsonReads(aws);
  });

  it("shows each Component's Extended Support setting, and one on Extended Support as AWOL", async () => {
    const aws = account();

    await scanAll(aws);

    const model = await awol(aws).pageModel();
    expect(model.kind === "signed-in" && model.lastScan?.components.map(({ identifier, status, extendedSupport }) => ({ identifier, status, extendedSupport }))).toEqual([
      // MySQL 8.0 left standard support on 2026-07-31.
      { identifier: "db-1", status: "AWOL", extendedSupport: "Extended Support" },
      { identifier: "db-2", status: "Falling behind", extendedSupport: "Extended Support" },
      { identifier: "db-3", status: "Falling behind", extendedSupport: "auto-upgrade at End of life" },
      { identifier: "db-4", status: "Current", extendedSupport: "Extended Support" },
      { identifier: "db-5", status: "Current", extendedSupport: "Extended Support" },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows a Component set to auto-upgrade as AWOL past End of life too", async () => {
    // PostgreSQL 13 left standard support on 2026-02-28.
    const { component, aws } = await scannedComponent({
      EngineVersion: "13.22",
      EngineLifecycleSupport: "open-source-rds-extended-support-disabled",
    });

    expect(component).toMatchObject({ status: "AWOL", extendedSupport: "auto-upgrade at End of life" });
    expectOnlyJsonReads(aws);
  });

  it("does not mark a row whose sources agree", async () => {
    const { component, aws } = await scannedComponent({ EngineVersion: "14.22" });

    expect(component).toMatchObject({
      sources: {
        aws: { endOfLife: "2027-02-28", extendedSupportEnd: "2030-02-28" },
        "endoflife.date": { endOfLife: "2027-02-28", extendedSupportEnd: "2030-02-28" },
      },
      datesDisagree: false,
    });
    expectOnlyJsonReads(aws);
  });
});

describe("Aurora and Multi-AZ DB clusters", () => {
  // The page's Components after a Scan of an account with only `clusters` in
  // eu-west-1 and the instances in `instances` there; and the fake runner, to
  // check last.
  async function scannedClusters(clusters: DbCluster[], instances: DbInstance[] = []) {
    const aws = account({ instances: { "eu-west-1": instances }, clusters: { "eu-west-1": clusters } });
    await scanAll(aws);
    const model = await awol(aws).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return { components: model.lastScan!.components, aws };
  }

  it("shows an Aurora PostgreSQL cluster as one Component", async () => {
    const { components, aws } = await scannedClusters([cluster("cluster-1")]);

    expect(components).toEqual([
      {
        service: "RDS",
        product: "Aurora PostgreSQL",
        region: "eu-west-1",
        identifier: "cluster-1",
        version: "15.4",
        extendedSupport: "Extended Support",
        releaseCycle: "15",
        status: "Current",
        cycleReleaseDate: "2022-11-10",
        endOfLife: "2028-02-29",
        extendedSupportEnd: "2031-02-28",
        sources: {
          aws: { endOfLife: "2028-02-29", extendedSupportEnd: "2031-02-28" },
          "endoflife.date": { endOfLife: "2028-02-29", extendedSupportEnd: "2031-02-28" },
        },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "behind", version: "15.19" },
          newestCycle: { kind: "behind", version: "18" },
          newestOffered: { kind: "behind", version: "18.6" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows an Aurora MySQL cluster as one Component, on the first number of the Aurora version inside its engine version", async () => {
    const { components, aws } = await scannedClusters([cluster("cluster-2")]);

    expect(components).toEqual([
      {
        service: "RDS",
        product: "Aurora MySQL",
        region: "eu-west-1",
        identifier: "cluster-2",
        version: "8.0.mysql_aurora.3.04.0",
        extendedSupport: "auto-upgrade at End of life",
        releaseCycle: "3",
        status: "Current",
        cycleReleaseDate: "2021-11-23",
        endOfLife: "2028-04-30",
        extendedSupportEnd: "2029-07-31",
        sources: {
          aws: { endOfLife: "2028-04-30", extendedSupportEnd: "2029-07-31" },
          "endoflife.date": { endOfLife: "2028-04-30", extendedSupportEnd: "2029-07-31" },
        },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "behind", version: "3.14" },
          newestCycle: { kind: "behind", version: "8.4" },
          newestOffered: { kind: "behind", version: "8.4.mysql_aurora.8.4.10" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows a Multi-AZ DB cluster as one Component of its engine's RDS Product", async () => {
    const { components, aws } = await scannedClusters([cluster("cluster-3")]);

    expect(components).toEqual([
      {
        service: "RDS",
        product: "RDS PostgreSQL",
        region: "eu-west-1",
        identifier: "cluster-3",
        version: "16.13",
        extendedSupport: "Extended Support",
        releaseCycle: "16",
        status: "Current",
        cycleReleaseDate: "2023-11-17",
        endOfLife: "2029-02-28",
        extendedSupportEnd: "2032-02-29",
        sources: {
          aws: { endOfLife: "2029-02-28", extendedSupportEnd: "2032-02-29" },
          "endoflife.date": { endOfLife: "2029-02-28", extendedSupportEnd: "2032-02-29" },
        },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "behind", version: "16.15" },
          newestCycle: { kind: "behind", version: "18" },
          newestOffered: { kind: "behind", version: "18.6" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows a cluster once, and none of its member instances", async () => {
    const { components, aws } = await scannedClusters(
      [cluster("cluster-1"), cluster("cluster-3")],
      [
        instance("db-6"),
        instance("cluster-1-instance-1", { Engine: "aurora-postgresql", EngineVersion: "15.4", DBClusterIdentifier: "cluster-1" }),
        instance("cluster-1-instance-2", { Engine: "aurora-postgresql", EngineVersion: "15.4", DBClusterIdentifier: "cluster-1" }),
        instance("cluster-3-instance-1", { EngineVersion: "16.13", DBClusterIdentifier: "cluster-3" }),
        instance("cluster-3-instance-2", { EngineVersion: "16.13", DBClusterIdentifier: "cluster-3" }),
      ],
    );

    expect(components.map(({ identifier }) => identifier)).toEqual(["cluster-1", "cluster-3", "db-6"]);
    expectOnlyJsonReads(aws);
  });

  it("leaves out DocumentDB and Neptune clusters", async () => {
    const { components, aws } = await scannedClusters(CLUSTERS);

    expect(components.map(({ identifier, product }) => ({ identifier, product }))).toEqual([
      { identifier: "cluster-1", product: "Aurora PostgreSQL" },
      { identifier: "cluster-2", product: "Aurora MySQL" },
      { identifier: "cluster-3", product: "RDS PostgreSQL" },
    ]);
    const engines = aws.calls.filter(([, subcommand]) => subcommand !== "describe-db-instances" && subcommand !== "describe-db-clusters").map((argv) => argv[5]);
    expect(engines).not.toContain("docdb");
    expect(engines).not.toContain("neptune");
    expectOnlyJsonReads(aws);
  });

  it.each([
    // Aurora PostgreSQL by major.
    ["aurora-postgresql", "15.4", "Aurora PostgreSQL", "15", "Current"],
    ["aurora-postgresql", "16.4-limitless", "Aurora PostgreSQL", "16", "Current"],
    ["aurora-postgresql", "13.23", "Aurora PostgreSQL", "13", "AWOL"],
    // Aurora MySQL by the first number of the Aurora version inside the
    // engine version, and from 8.4 by x.y.
    ["aurora-mysql", "8.0.mysql_aurora.3.04.0", "Aurora MySQL", "3", "Current"],
    ["aurora-mysql", "5.7.mysql_aurora.2.12.6", "Aurora MySQL", "2", "AWOL"],
    ["aurora-mysql", "8.4.mysql_aurora.8.4.7", "Aurora MySQL", "8.4", "Current"],
    // Multi-AZ DB clusters as RDS.
    ["postgres", "16.13", "RDS PostgreSQL", "16", "Current"],
    ["mysql", "8.4.7", "RDS MySQL", "8.4.7", "Current"],
  ])("matches a %s cluster on %s to %s Release Cycle %s", async (engine, version, product, releaseCycle, status) => {
    const { components, aws } = await scannedClusters([cluster("cluster-6", { Engine: engine, EngineVersion: version })]);

    expect(components).toMatchObject([{ product, version, releaseCycle, status }]);
    expectOnlyJsonReads(aws);
  });

  it("decides Status with AWS's End of life over endoflife.date's, marking the row", async () => {
    // The recorded Aurora PostgreSQL lifecycles, with standard support for 15
    // ending on 2027-02-28 instead of 2028-02-29.
    const earlier = structuredClone(auroraPostgresqlMajorVersions);
    earlier.DBMajorEngineVersions.find(({ MajorEngineVersion }) => MajorEngineVersion === "15")!.SupportedEngineLifecycles[0]!.LifecycleSupportEndDate =
      "2027-02-28T23:59:59.999000+00:00";
    const aws = account({
      instances: {},
      clusters: { "eu-west-1": [cluster("cluster-1")] },
      majorVersions: { ...MAJOR_VERSIONS, "aurora-postgresql": earlier },
    });

    await scanAll(aws);

    expect(await awol(aws).pageModel()).toMatchObject({
      lastScan: {
        components: [
          {
            identifier: "cluster-1",
            status: "Falling behind",
            endOfLife: "2027-02-28",
            sources: { aws: { endOfLife: "2027-02-28" }, "endoflife.date": { endOfLife: "2028-02-29" } },
            datesDisagree: true,
          },
        ],
      },
    });
    expectOnlyJsonReads(aws);
  });

  it("decides Status with endoflife.date's End of life where AWS gives none: Aurora MySQL 8.4", async () => {
    const { components, aws } = await scannedClusters([cluster("cluster-2", { EngineVersion: "8.4.mysql_aurora.8.4.7" })]);

    expect(components).toMatchObject([
      {
        releaseCycle: "8.4",
        status: "Current",
        endOfLife: "2032-04-30",
        sources: { aws: {}, "endoflife.date": { endOfLife: "2032-04-30" } },
        datesDisagree: false,
      },
    ]);
    expect(components[0]!.sources.aws.endOfLife).toBeUndefined();
    expectOnlyJsonReads(aws);
  });

  it.each([
    // Aurora MySQL 3's Latest patch is 3.14; AWS offers up to 8.4.10.
    [
      "8.0.mysql_aurora.3.04.0",
      { latestPatch: { kind: "behind", version: "3.14" }, newestCycle: { kind: "behind", version: "8.4" }, newestOffered: { kind: "behind", version: "8.4.mysql_aurora.8.4.10" } },
    ],
    [
      "8.4.mysql_aurora.8.4.7",
      { latestPatch: { kind: "behind", version: "8.4.10" }, newestCycle: { kind: "none" }, newestOffered: { kind: "behind", version: "8.4.mysql_aurora.8.4.10" } },
    ],
    ["8.4.mysql_aurora.8.4.10", { latestPatch: { kind: "none" }, newestCycle: { kind: "none" }, newestOffered: { kind: "none" } }],
  ])("shows Aurora MySQL %s's Drift", async (version, drift) => {
    const { components, aws } = await scannedClusters([cluster("cluster-2", { EngineVersion: version })]);

    expect(components[0]!.drift).toEqual(drift);
    expectOnlyJsonReads(aws);
  });
});

describe("Drift for RDS", () => {
  it.each([
    // endoflife.date's Latest patch of PostgreSQL 14 is 14.24.
    ["postgres", "14.22", { kind: "behind", version: "14.24" }],
    ["postgres", "14.24", { kind: "none" }],
    // An RDS build of the Latest patch is on it: MySQL 8.0.46's is 8.0.46.
    ["mysql", "8.0.46-rds.20260624", { kind: "none" }],
    // MySQL 8.4.7 is its own Release Cycle within 8.4, whose Latest patch is
    // 8.4.11.
    ["mysql", "8.4.7", { kind: "behind", version: "8.4.11" }],
    ["mysql", "8.4.10", { kind: "behind", version: "8.4.11" }],
    ["mysql", "8.4.11", { kind: "none" }],
    ["mariadb", "10.11.15", { kind: "behind", version: "10.11.19" }],
  ])("shows %s %s's Drift from its Latest patch", async (engine, version, latestPatch) => {
    const { component, aws } = await scannedComponent({ Engine: engine, EngineVersion: version });

    expect(component.drift.latestPatch).toEqual(latestPatch);
    expectOnlyJsonReads(aws);
  });

  it("shows the Latest patch Drift as not available where endoflife.date gives no Latest patch", async () => {
    // The recorded PostgreSQL product, with no Latest patch for 17.
    const noLatest = structuredClone(rdsPostgresql);
    noLatest.result.releases.find(({ name }) => name === "17")!.latest = null as never;
    const endOfLife = fakeEndOfLife({ ...RECORDED_PRODUCTS, "amazon-rds-postgresql": { etag: '"no-latest"', body: noLatest } });

    const { component, aws } = await scannedComponent({ EngineVersion: "17.9" }, { endOfLife });

    expect(component.drift.latestPatch).toEqual({ kind: "not-available" });
    expectOnlyJsonReads(aws);
  });

  it.each([
    // The Newest cycle is the one with the highest Latest patch: PostgreSQL 18
    // (18.6), MySQL 8.4 (8.4.11) and MariaDB 12.3 (12.3.3).
    ["postgres", "17.9", { kind: "behind", version: "18" }],
    ["postgres", "18.1", { kind: "none" }],
    ["mysql", "8.0.46-rds.20260624", { kind: "behind", version: "8.4" }],
    // MySQL 8.4.7 is its own Release Cycle, within 8.4.
    ["mysql", "8.4.7", { kind: "none" }],
    ["mysql", "8.4.10", { kind: "none" }],
    ["mariadb", "11.8.3", { kind: "behind", version: "12.3" }],
    ["mariadb", "12.3.2", { kind: "none" }],
  ])("shows %s %s's Drift from the Newest cycle", async (engine, version, newestCycle) => {
    const { component, aws } = await scannedComponent({ Engine: engine, EngineVersion: version });

    expect(component.drift.newestCycle).toEqual(newestCycle);
    expectOnlyJsonReads(aws);
  });

  it.each([
    // AWS offers up to PostgreSQL 18.6, MySQL 8.4.11 and MariaDB 12.3.3 in
    // eu-west-1.
    ["postgres", "17.9", { kind: "behind", version: "18.6" }],
    ["postgres", "18.6", { kind: "none" }],
    ["mysql", "8.0.46-rds.20260624", { kind: "behind", version: "8.4.11" }],
    ["mysql", "8.4.11", { kind: "none" }],
    ["mariadb", "11.8.3", { kind: "behind", version: "12.3.3" }],
    ["mariadb", "12.3.3", { kind: "none" }],
  ])("shows %s %s's Drift from the Newest offered version", async (engine, version, newestOffered) => {
    const { component, aws } = await scannedComponent({ Engine: engine, EngineVersion: version });

    expect(component.drift.newestOffered).toEqual(newestOffered);
    expectOnlyJsonReads(aws);
  });

  it("reads the Newest offered version in each Component's own region", async () => {
    // The recorded PostgreSQL versions, with nothing past 18.4 offered in
    // us-west-2.
    const older = structuredClone(postgresEngineVersions);
    older.DBEngineVersions = older.DBEngineVersions.filter(({ EngineVersion }) => EngineVersion !== "18.6");
    const instances = { "eu-west-1": [instance("db-6", { EngineVersion: "18.4" })], "us-west-2": [instance("db-7", { EngineVersion: "18.4" })] };
    const aws = fakeAws({
      ...accountAnswers({ instances }),
      [describeEngineVersionsIn("us-west-2", "postgres")]: { stdout: JSON.stringify(older) },
    });

    await scanAll(aws);

    const model = await awol(aws).pageModel();
    expect(model.kind === "signed-in" && model.lastScan?.components.map(({ identifier, drift }) => ({ identifier, newestOffered: drift.newestOffered }))).toEqual([
      { identifier: "db-6", newestOffered: { kind: "behind", version: "18.6" } },
      { identifier: "db-7", newestOffered: { kind: "none" } },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows no Drift for a Component on the Latest patch, the Newest cycle and the Newest offered version", async () => {
    const { component, aws } = await scannedComponent({ EngineVersion: "18.6" });

    expect(component.drift).toEqual({ latestPatch: { kind: "none" }, newestCycle: { kind: "none" }, newestOffered: { kind: "none" } });
    expectOnlyJsonReads(aws);
  });

  it.each([
    // Behind every figure, on its Latest patch only, and behind none.
    ["17.5", "Current"],
    ["17.11", "Current"],
    ["18.6", "Current"],
    // On its Latest patch, and past End of life.
    ["13.23", "AWOL"],
  ])("never changes Status: PostgreSQL %s is %s", async (version, status) => {
    const { component, aws } = await scannedComponent({ EngineVersion: version });

    expect(component.status).toBe(status);
    expectOnlyJsonReads(aws);
  });

  it.each([
    ["postgres", "19.1"],
    ["mysql", "9.4.0"],
    ["mariadb", "12.4.1"],
  ])("shows %s %s, which matches no Release Cycle, with Drift from the Newest offered version only", async (engine, version) => {
    const { component, aws } = await scannedComponent({ Engine: engine, EngineVersion: version });

    expect(component.drift).toEqual({
      latestPatch: { kind: "not-available" },
      newestCycle: { kind: "not-available" },
      newestOffered: { kind: "none" },
    });
    expectOnlyJsonReads(aws);
  });
});

describe("ElastiCache Redis OSS caches", () => {
  // The page's Components after a Scan of an account with no RDS and only the
  // given replication groups, with their members, standalone cache clusters
  // and Serverless caches in eu-west-1; and the fake runner, to check last.
  async function scannedCaches({
    groups = [],
    standalone = [],
    serverless = [],
  }: {
    groups?: { group: ReplicationGroup; members: CacheCluster[] }[];
    standalone?: CacheCluster[];
    serverless?: ServerlessCache[];
  }) {
    const aws = account({
      instances: {},
      replicationGroups: { "eu-west-1": groups.map(({ group }) => group) },
      cacheClusters: { "eu-west-1": [...groups.flatMap(({ members }) => members), ...standalone] },
      serverlessCaches: { "eu-west-1": serverless },
    });
    await scanAll(aws);
    const model = await awol(aws).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return { components: model.lastScan!.components, aws };
  }

  it("shows a replication group as one Component, on its member cache clusters' version", async () => {
    const { components, aws } = await scannedCaches({ groups: [replicationGroup("group-2")] });

    expect(components).toEqual([
      {
        service: "ElastiCache",
        product: "ElastiCache Redis OSS",
        region: "eu-west-1",
        identifier: "group-2",
        version: "6.2.6",
        releaseCycle: "6",
        status: "Falling behind",
        cycleReleaseDate: "2020-10-13",
        endOfLife: "2027-01-31",
        extendedSupportEnd: "2030-01-31",
        sources: { aws: {}, "endoflife.date": { endOfLife: "2027-01-31", extendedSupportEnd: "2030-01-31" } },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "behind", version: "7" },
          newestOffered: { kind: "behind", version: "7.1" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("takes the lowest version among a replication group's members, as part-way through an upgrade", async () => {
    const { group, members } = replicationGroup("group-1");
    const upgrading = [{ ...members[0]!, EngineVersion: "6.2.6" }, members[1]!];

    const { components, aws } = await scannedCaches({ groups: [{ group, members: upgrading }] });

    expect(components).toMatchObject([{ identifier: "group-1", version: "5.0.6", releaseCycle: "5", status: "AWOL" }]);
    expectOnlyJsonReads(aws);
  });

  it("shows a replication group none of whose members AWS lists, as when created between two calls, as Untracked with no version", async () => {
    const { components, aws } = await scannedCaches({ groups: [{ group: replicationGroup("group-2").group, members: [] }] });

    expect(components).toEqual([
      {
        service: "ElastiCache",
        product: "ElastiCache Redis OSS",
        region: "eu-west-1",
        identifier: "group-2",
        status: "Untracked",
        sources: { aws: {}, "endoflife.date": {} },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "not-available" },
          newestOffered: { kind: "not-available" },
        },
      },
    ]);
    expect(components[0]!.version).toBeUndefined();
    expectOnlyJsonReads(aws);
  });

  it("shows a standalone cache cluster as one Component, and no member of a replication group, which AWS lists among cache clusters", async () => {
    const { components, aws } = await scannedCaches({
      groups: [replicationGroup("group-1"), replicationGroup("group-2")],
      standalone: [cacheCluster("cache-1")],
    });

    expect(components.map(({ identifier, version, status }) => ({ identifier, version, status }))).toEqual([
      { identifier: "group-1", version: "5.0.6", status: "AWOL" },
      { identifier: "cache-1", version: "5.0.6", status: "AWOL" },
      { identifier: "group-2", version: "6.2.6", status: "Falling behind" },
    ]);
    expect(components[1]).toEqual({
      service: "ElastiCache",
      product: "ElastiCache Redis OSS",
      region: "eu-west-1",
      identifier: "cache-1",
      version: "5.0.6",
      releaseCycle: "5",
      status: "AWOL",
      cycleReleaseDate: "2018-10-17",
      endOfLife: "2026-01-31",
      extendedSupportEnd: "2029-01-31",
      sources: { aws: {}, "endoflife.date": { endOfLife: "2026-01-31", extendedSupportEnd: "2029-01-31" } },
      datesDisagree: false,
      drift: {
        latestPatch: { kind: "not-available" },
        newestCycle: { kind: "behind", version: "7" },
        newestOffered: { kind: "behind", version: "7.1" },
      },
    });
    expectOnlyJsonReads(aws);
  });

  it("shows a Serverless cache as one Component, on its full engine version", async () => {
    const { components, aws } = await scannedCaches({ serverless: [serverlessCache("serverless-1")] });

    expect(components).toEqual([
      {
        service: "ElastiCache",
        product: "ElastiCache Redis OSS",
        region: "eu-west-1",
        identifier: "serverless-1",
        version: "7.1",
        releaseCycle: "7",
        status: "Current",
        cycleReleaseDate: "2022-04-12",
        sources: { aws: {}, "endoflife.date": {} },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "none" },
          newestOffered: { kind: "none" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("leaves out Valkey and Memcached caches", async () => {
    const { components, aws } = await scannedCaches({
      groups: REPLICATION_GROUPS.map(({ ReplicationGroupId }) => replicationGroup(ReplicationGroupId)),
      standalone: [cacheCluster("cache-1"), cacheCluster("cache-2", { Engine: "memcached", EngineVersion: "1.6.22" })],
      serverless: SERVERLESS_CACHES,
    });

    expect(components.map(({ identifier }) => identifier).sort()).toEqual(["cache-1", "group-1", "group-2", "group-3", "group-4", "serverless-1"]);
    const engines = aws.calls.filter(([, subcommand]) => subcommand === "describe-cache-engine-versions").map((argv) => argv[5]);
    expect(new Set(engines)).toEqual(new Set(["redis"]));
    expectOnlyJsonReads(aws);
  });

  it.each([
    // By major. endoflife.date ends standard support for 4 and 5 on
    // 2026-01-31 and for 6 on 2027-01-31, and announces none for 7.
    ["4.0.10", "4", "AWOL"],
    ["5.0.6", "5", "AWOL"],
    ["6.2.6", "6", "Falling behind"],
    ["7.0.7", "7", "Current"],
    ["7.1.0", "7", "Current"],
  ])("matches a replication group on Redis OSS %s to Release Cycle %s", async (version, releaseCycle, status) => {
    const { components, aws } = await scannedCaches({ groups: [replicationGroup("group-1", { EngineVersion: version })] });

    expect(components).toMatchObject([{ product: "ElastiCache Redis OSS", version, releaseCycle, status }]);
    expectOnlyJsonReads(aws);
  });

  it.each([
    // endoflife.date gives no Redis OSS cycle a Latest patch, so the Newest
    // cycle is 7; AWS offers up to 7.1 in eu-west-1.
    ["5.0.6", { latestPatch: { kind: "not-available" }, newestCycle: { kind: "behind", version: "7" }, newestOffered: { kind: "behind", version: "7.1" } }],
    ["7.0.7", { latestPatch: { kind: "not-available" }, newestCycle: { kind: "none" }, newestOffered: { kind: "behind", version: "7.1" } }],
    ["7.1.0", { latestPatch: { kind: "not-available" }, newestCycle: { kind: "none" }, newestOffered: { kind: "none" } }],
  ])("shows Redis OSS %s's Drift", async (version, drift) => {
    const { components, aws } = await scannedCaches({ groups: [replicationGroup("group-1", { EngineVersion: version })] });

    expect(components[0]!.drift).toEqual(drift);
    expectOnlyJsonReads(aws);
  });

  it("reads the Newest offered version in each Component's own region", async () => {
    // The recorded Redis OSS versions, with nothing past 7.0 offered in
    // us-west-2.
    const older = structuredClone(redisCacheEngineVersions);
    older.CacheEngineVersions = older.CacheEngineVersions.filter(({ EngineVersion }) => EngineVersion !== "7.1");
    const aws = fakeAws({
      ...accountAnswers({
        instances: {},
        cacheClusters: { "eu-west-1": [cacheCluster("cache-1", { EngineVersion: "7.0.7" })], "us-west-2": [cacheCluster("cache-2", { EngineVersion: "7.0.7" })] },
      }),
      [describeCacheEngineVersionsIn("us-west-2", "redis")]: { stdout: JSON.stringify(older) },
    });

    await scanAll(aws);

    const model = await awol(aws).pageModel();
    expect(model.kind === "signed-in" && model.lastScan?.components.map(({ identifier, drift }) => ({ identifier, newestOffered: drift.newestOffered }))).toEqual([
      { identifier: "cache-1", newestOffered: { kind: "behind", version: "7.1" } },
      { identifier: "cache-2", newestOffered: { kind: "none" } },
    ]);
    expectOnlyJsonReads(aws);
  });
});

describe("OpenSearch domains", () => {
  // The page's Components after a Scan of an account with no RDS and only
  // `domains` in eu-west-1, on `now`; and the fake runner, to check last.
  async function scannedDomains(domains: Domain[], now = NOW) {
    const aws = account({ instances: {}, domains: { "eu-west-1": domains } });
    await scanAll(aws, now);
    const model = await awol(aws, now).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return { components: model.lastScan!.components, aws };
  }

  it("shows an OpenSearch domain as one Component", async () => {
    const { components, aws } = await scannedDomains([domain("domain-1")]);

    expect(components).toEqual([
      {
        service: "OpenSearch",
        product: "OpenSearch",
        region: "eu-west-1",
        identifier: "domain-1",
        version: "OpenSearch_2.11",
        releaseCycle: "2.11",
        status: "Current",
        cycleReleaseDate: "2023-11-17",
        endOfLife: "2027-11-07",
        extendedSupportEnd: "2028-11-07",
        sources: { aws: {}, "endoflife.date": { endOfLife: "2027-11-07", extendedSupportEnd: "2028-11-07" } },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "behind", version: "3.7" },
          newestOffered: { kind: "behind", version: "OpenSearch_3.7" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows an Elasticsearch domain as one Component of the Elasticsearch Product", async () => {
    const { components, aws } = await scannedDomains([domain("domain-2")]);

    expect(components).toEqual([
      {
        service: "OpenSearch",
        product: "Elasticsearch",
        region: "eu-west-1",
        identifier: "domain-2",
        version: "Elasticsearch_7.10",
        releaseCycle: "7.10",
        status: "Current",
        cycleReleaseDate: "2021-04-21",
        endOfLife: "2027-11-07",
        extendedSupportEnd: "2030-11-07",
        sources: { aws: {}, "endoflife.date": { endOfLife: "2027-11-07", extendedSupportEnd: "2030-11-07" } },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "none" },
          newestOffered: { kind: "none" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows a domain whose Release Cycle has no End of life announced as Current, with no End of life", async () => {
    // endoflife.date announces no End of life for any OpenSearch 3.x cycle.
    const { components, aws } = await scannedDomains([domain("domain-3")], new Date("2040-01-01T12:00:00Z"));

    expect(components).toEqual([
      {
        service: "OpenSearch",
        product: "OpenSearch",
        region: "eu-west-1",
        identifier: "domain-3",
        version: "OpenSearch_3.5",
        releaseCycle: "3.5",
        status: "Current",
        cycleReleaseDate: "2026-03-18",
        sources: { aws: {}, "endoflife.date": {} },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "behind", version: "3.7" },
          newestOffered: { kind: "behind", version: "OpenSearch_3.7" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it.each([
    // By x.y on amazon-opensearch. endoflife.date ends standard support for
    // 1.3 and 2.11 on 2027-11-07 and for 2.9 on 2025-11-07.
    ["OpenSearch_1.3", "OpenSearch", "1.3", "Current"],
    ["OpenSearch_2.9", "OpenSearch", "2.9", "AWOL"],
    ["OpenSearch_2.11", "OpenSearch", "2.11", "Current"],
    ["OpenSearch_3.7", "OpenSearch", "3.7", "Current"],
    // By x.y on amazon-elasticsearch. endoflife.date ends standard support for
    // 6.8 and 7.10 on 2027-11-07 and for 5.6 and 7.1 on 2025-11-07.
    ["Elasticsearch_5.6", "Elasticsearch", "5.6", "AWOL"],
    ["Elasticsearch_6.8", "Elasticsearch", "6.8", "Current"],
    ["Elasticsearch_7.1", "Elasticsearch", "7.1", "AWOL"],
    ["Elasticsearch_7.10", "Elasticsearch", "7.10", "Current"],
  ])("matches a domain on %s to %s Release Cycle %s", async (version, product, releaseCycle, status) => {
    const { components, aws } = await scannedDomains([domain("domain-1", { EngineVersion: version })]);

    expect(components).toMatchObject([{ product, version, releaseCycle, status }]);
    expectOnlyJsonReads(aws);
  });

  it.each([
    ["OpenSearch_4.0", "OpenSearch"],
    // Elasticsearch 7.10 is the last; 2.11 is an OpenSearch cycle only.
    ["Elasticsearch_2.11", "Elasticsearch"],
  ])("shows a domain on %s, which matches no Release Cycle, as Untracked", async (version, product) => {
    const { components, aws } = await scannedDomains([domain("domain-1", { EngineVersion: version })]);

    expect(components).toMatchObject([{ product, version, releaseCycle: undefined, status: "Untracked" }]);
    expectOnlyJsonReads(aws);
  });

  it.each([
    // endoflife.date gives no cycle a Latest patch, so the Newest cycle is the
    // highest name, 3.7 and 7.10; AWS offers up to OpenSearch_3.7 and
    // Elasticsearch_7.10 in eu-west-1, each engine compared with its own.
    ["OpenSearch_2.11", { latestPatch: { kind: "not-available" }, newestCycle: { kind: "behind", version: "3.7" }, newestOffered: { kind: "behind", version: "OpenSearch_3.7" } }],
    ["OpenSearch_3.7", { latestPatch: { kind: "not-available" }, newestCycle: { kind: "none" }, newestOffered: { kind: "none" } }],
    ["Elasticsearch_7.9", { latestPatch: { kind: "not-available" }, newestCycle: { kind: "behind", version: "7.10" }, newestOffered: { kind: "behind", version: "Elasticsearch_7.10" } }],
    ["Elasticsearch_7.10", { latestPatch: { kind: "not-available" }, newestCycle: { kind: "none" }, newestOffered: { kind: "none" } }],
  ])("shows %s's Drift", async (version, drift) => {
    const { components, aws } = await scannedDomains([domain("domain-1", { EngineVersion: version })]);

    expect(components[0]!.drift).toEqual(drift);
    expectOnlyJsonReads(aws);
  });

  it("reads the Newest offered version in each Component's own region", async () => {
    // The recorded versions, with nothing past OpenSearch 3.5 offered in
    // us-west-2.
    const older = { Versions: openSearchVersions.Versions.filter((version) => version !== "OpenSearch_3.7") };
    const aws = fakeAws({
      ...accountAnswers({
        instances: {},
        domains: { "eu-west-1": [domain("domain-3")], "us-west-2": [domain("domain-3", { DomainName: "domain-4" })] },
      }),
      [listVersionsIn("us-west-2")]: { stdout: JSON.stringify(older) },
    });

    await scanAll(aws);

    const model = await awol(aws).pageModel();
    expect(model.kind === "signed-in" && model.lastScan?.components.map(({ identifier, drift }) => ({ identifier, newestOffered: drift.newestOffered }))).toEqual([
      { identifier: "domain-3", newestOffered: { kind: "behind", version: "OpenSearch_3.7" } },
      { identifier: "domain-4", newestOffered: { kind: "none" } },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows every domain of a region with more than five, the most AWS describes in one call", async () => {
    const domains = Array.from({ length: 7 }, (_, i) => domain("domain-1", { DomainName: `domain-${i + 4}` }));

    const { components, aws } = await scannedDomains(domains);

    expect(components.map(({ identifier }) => identifier).sort()).toEqual(domains.map(({ DomainName }) => DomainName).sort());
    expectOnlyJsonReads(aws);
  });

  it("leaves out a domain AWS lists but no longer describes, as when deleted between two calls", async () => {
    const aws = fakeAws({
      ...accountAnswers({ instances: {}, domains: { "eu-west-1": [domain("domain-1"), domain("domain-2")] } }),
      [describeDomainsIn("eu-west-1", ["domain-1", "domain-2"])]: { stdout: JSON.stringify({ DomainStatusList: [domain("domain-1")] }) },
    });

    await scanAll(aws);

    const model = await awol(aws).pageModel();
    expect(model.kind === "signed-in" && model.lastScan?.components.map(({ identifier }) => identifier)).toEqual(["domain-1"]);
    expectOnlyJsonReads(aws);
  });
});

describe("Lambda functions", () => {
  // The page's Components after a Scan of an account with no RDS and only
  // `functions` in eu-west-1, on `now`; and the fake runner, to check last.
  async function scannedFunctions(functions: DeployedFunction[], now = NOW) {
    const aws = account({ instances: {}, functions: { "eu-west-1": functions } });
    await scanAll(aws, now);
    const model = await awol(aws, now).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return { components: model.lastScan!.components, aws };
  }

  it("shows a function's $LATEST as one Component, its runtime's deprecation date as End of life", async () => {
    const { components, aws } = await scannedFunctions([{ latest: lambdaFunction("function-6") }]);

    expect(components).toEqual([
      {
        service: "Lambda",
        product: "AWS Lambda",
        region: "eu-west-1",
        identifier: "function-6:$LATEST",
        version: "python3.12",
        releaseCycle: "python3.12",
        status: "Current",
        cycleReleaseDate: "2023-12-14",
        endOfLife: "2028-10-31",
        sources: { aws: {}, "endoflife.date": { endOfLife: "2028-10-31" } },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "behind", version: "python3.14" },
          newestOffered: { kind: "not-available" },
        },
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  // The recorded function function-6, on python3.12, with the hand-written
  // aliases named in `aliasNames` and published versions 9 to 12, version 9
  // on python3.9, 10 on python3.10, 11 on python3.11 and 12 on python3.12.
  function aliasedFunction(aliasNames: string[]): DeployedFunction {
    const latest = lambdaFunction("function-6");
    return {
      latest,
      aliases: ALIASES.filter(({ Name }) => aliasNames.includes(Name)),
      versions: [9, 10, 11, 12].map((version) => ({ ...latest, Version: `${version}`, Runtime: `python3.${version}` })),
    };
  }

  it("shows a published version an alias points to as its own Component, on that version's own runtime", async () => {
    const { components, aws } = await scannedFunctions([aliasedFunction(["previous"])]);

    expect(components).toEqual([
      {
        service: "Lambda",
        product: "AWS Lambda",
        region: "eu-west-1",
        identifier: "function-6:9",
        version: "python3.9",
        releaseCycle: "python3.9",
        status: "AWOL",
        cycleReleaseDate: "2021-08-16",
        endOfLife: "2025-12-15",
        sources: { aws: {}, "endoflife.date": { endOfLife: "2025-12-15" } },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "behind", version: "python3.14" },
          newestOffered: { kind: "not-available" },
        },
      },
      expect.objectContaining({ identifier: "function-6:$LATEST", version: "python3.12", status: "Current" }),
    ]);
    expectOnlyJsonReads(aws);
  });

  it("shows each version aliases point to once, including the second version of a weighted alias, and $LATEST once", async () => {
    const { components, aws } = await scannedFunctions([aliasedFunction(["beta", "canary", "live", "previous"])]);

    expect(components.map(({ identifier, version, status }) => ({ identifier, version, status })).sort((a, b) => a.identifier.localeCompare(b.identifier))).toEqual([
      { identifier: "function-6:$LATEST", version: "python3.12", status: "Current" },
      { identifier: "function-6:11", version: "python3.11", status: "Current" },
      { identifier: "function-6:12", version: "python3.12", status: "Current" },
      { identifier: "function-6:9", version: "python3.9", status: "AWOL" },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("leaves out a published version no alias points to", async () => {
    const { components, aws } = await scannedFunctions([aliasedFunction(["live"])]);

    expect(components.map(({ identifier }) => identifier).sort()).toEqual(["function-6:$LATEST", "function-6:12"]);
    expectOnlyJsonReads(aws);
  });

  it("shows a function deployed as a container image, which has no runtime, as Untracked with no version", async () => {
    const { components, aws } = await scannedFunctions([{ latest: lambdaFunction("function-1") }]);

    expect(components).toEqual([
      {
        service: "Lambda",
        product: "AWS Lambda",
        region: "eu-west-1",
        identifier: "function-1:$LATEST",
        status: "Untracked",
        sources: { aws: {}, "endoflife.date": {} },
        datesDisagree: false,
        drift: {
          latestPatch: { kind: "not-available" },
          newestCycle: { kind: "not-available" },
          newestOffered: { kind: "not-available" },
        },
      },
    ]);
    expect(components[0]!.version).toBeUndefined();
    expectOnlyJsonReads(aws);
  });

  it.each([
    // End of life is the deprecation date: python3.8's 2024-10-14 and
    // python3.10's 2026-10-31 have passed, though AWS blocks updates to
    // either only from 2027-08-31.
    ["python3.8", "AWOL"],
    ["python3.10", "AWOL"],
    ["nodejs20.x", "AWOL"],
    // nodejs22.x reaches End of life on 2027-04-30, within 180 days, and
    // dotnet9 on 2026-11-10, with no date to block updates announced.
    ["nodejs22.x", "Falling behind"],
    ["dotnet9", "Falling behind"],
    ["python3.11", "Current"],
    ["provided.al2023", "Current"],
    ["java8.al2023", "Current"],
  ])("matches a function on %s to its Release Cycle, %s", async (runtime, status) => {
    const { components, aws } = await scannedFunctions([{ latest: lambdaFunction("function-6", { Runtime: runtime }) }]);

    expect(components).toMatchObject([{ product: "AWS Lambda", version: runtime, releaseCycle: runtime, status }]);
    expectOnlyJsonReads(aws);
  });

  it("shows a function on a runtime endoflife.date does not list as Untracked", async () => {
    const { components, aws } = await scannedFunctions([{ latest: lambdaFunction("function-6", { Runtime: "python3.99" }) }]);

    expect(components).toMatchObject([{ version: "python3.99", releaseCycle: undefined, status: "Untracked" }]);
    expectOnlyJsonReads(aws);
  });

  it.each([
    // python3.12 reaches End of life on 2028-10-31: Falling behind from 180
    // days before, and AWOL from that day.
    ["2028-05-03", "Current"],
    ["2028-05-04", "Falling behind"],
    ["2028-10-30", "Falling behind"],
    ["2028-10-31", "AWOL"],
  ])("shows a function on python3.12 on %s as %s", async (date, status) => {
    const { components, aws } = await scannedFunctions([{ latest: lambdaFunction("function-6") }], new Date(`${date}T12:00:00Z`));

    expect(components).toMatchObject([{ releaseCycle: "python3.12", endOfLife: "2028-10-31", status }]);
    expectOnlyJsonReads(aws);
  });

  it.each([
    // The Newest cycle is the newest runtime of the same language, by the
    // language's version, not the newest of every Lambda runtime.
    ["python3.8", { kind: "behind", version: "python3.14" }],
    ["python3.14", { kind: "none" }],
    ["nodejs20.x", { kind: "behind", version: "nodejs24.x" }],
    // java25 over the al2023 runtimes endoflife.date lists as released later.
    ["java17.al2023", { kind: "behind", version: "java25" }],
    ["java8.al2", { kind: "behind", version: "java25" }],
    ["java25", { kind: "none" }],
    // The custom runtimes have no language version, so by release date.
    ["provided.al2", { kind: "behind", version: "provided.al2023" }],
    // The old dotnetcore runtimes are .NET too.
    ["dotnetcore3.1", { kind: "behind", version: "dotnet10" }],
    ["ruby3.2", { kind: "behind", version: "ruby4.0" }],
    ["go1.x", { kind: "none" }],
  ])("shows a function on %s with no Latest patch or Newest offered Drift, and its Newest cycle Drift", async (runtime, newestCycle) => {
    const { components, aws } = await scannedFunctions([{ latest: lambdaFunction("function-6", { Runtime: runtime }) }]);

    expect(components[0]!.drift).toEqual({ latestPatch: { kind: "not-available" }, newestCycle, newestOffered: { kind: "not-available" } });
    expectOnlyJsonReads(aws);
  });
});

describe("the dashboard's filters, grouping, sorting and pages", () => {
  // The page's last Scan of an account with the recorded RDS instances, a
  // function on python3.8 and one on python3.12 in eu-west-1, and an instance
  // on PostgreSQL 13 and a container-image function in us-east-1, most urgent
  // first:
  //
  //   AWOL            function-9:$LATEST  AWS Lambda python3.8  eu-west-1
  //   AWOL            db-6                RDS PostgreSQL 13      us-east-1
  //   AWOL            db-1                RDS MySQL 8.0.46       eu-west-1
  //   Falling behind  db-2, db-3          RDS PostgreSQL 14      eu-west-1
  //   Current         function-6:$LATEST  AWS Lambda python3.12  eu-west-1
  //   Current         db-4                RDS PostgreSQL 16      eu-west-1
  //   Current         db-5                RDS PostgreSQL 17      eu-west-1
  //   Untracked       function-1:$LATEST  AWS Lambda             us-east-1
  //
  // with `more` functions on python3.12 in eu-west-1 after function-6, and
  // the fake runner, to check last.
  async function scannedAccount(more = 0) {
    const aws = account({
      instances: {
        "eu-west-1": describeDbInstances.DBInstances,
        "us-east-1": [instance("db-6", { EngineVersion: "13.22" })],
      },
      functions: {
        "eu-west-1": [
          { latest: lambdaFunction("function-9") },
          { latest: lambdaFunction("function-6") },
          ...Array.from({ length: more }, (_, i) => ({ latest: lambdaFunction("function-6", { FunctionName: `function-${11 + i}` }) })),
        ],
        "us-east-1": [{ latest: lambdaFunction("function-1") }],
      },
    });
    await scanAll(aws);
    const model = await awol(aws).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return { lastScan: model.lastScan!, aws };
  }

  // Each group of `view`, as its Product, its Release Cycle and its
  // Components' identifiers.
  function groupsOf(view: DashboardView) {
    return view.groups.map(({ product, releaseCycle, components }) => ({
      product,
      releaseCycle,
      identifiers: components.map(({ identifier }) => identifier),
    }));
  }

  it("shows only the Components with the chosen Statuses, and counts only those", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, filters: { ...NO_FILTERS, statuses: ["AWOL", "Untracked"] } });

    expect(groupsOf(view)).toEqual([
      { identifiers: ["function-9:$LATEST", "db-6", "db-1", "function-1:$LATEST"] },
    ]);
    expect(view.counts).toEqual({ AWOL: 3, "Falling behind": 0, Current: 0, Untracked: 1 });
    expectOnlyJsonReads(aws);
  });

  it("shows only the Components that pass every filter, any of the values chosen in each", async () => {
    const { lastScan, aws } = await scannedAccount();

    const byProductAndRegion = dashboardViewOf(lastScan, {
      ...INITIAL_TABLE_STATE,
      filters: { ...NO_FILTERS, products: ["AWS Lambda", "RDS MySQL"], regions: ["eu-west-1"] },
    });
    const byServiceAndRegion = dashboardViewOf(lastScan, {
      ...INITIAL_TABLE_STATE,
      filters: { ...NO_FILTERS, services: ["RDS"], regions: ["us-east-1"] },
    });
    const byEverything = dashboardViewOf(lastScan, {
      ...INITIAL_TABLE_STATE,
      filters: { services: ["Lambda"], products: ["AWS Lambda"], regions: ["eu-west-1", "us-east-1"], statuses: ["Current", "Untracked"] },
    });

    expect(groupsOf(byProductAndRegion)).toEqual([{ identifiers: ["function-9:$LATEST", "db-1", "function-6:$LATEST"] }]);
    expect(byProductAndRegion.counts).toEqual({ AWOL: 2, "Falling behind": 0, Current: 1, Untracked: 0 });
    expect(groupsOf(byServiceAndRegion)).toEqual([{ identifiers: ["db-6"] }]);
    expect(groupsOf(byEverything)).toEqual([{ identifiers: ["function-6:$LATEST", "function-1:$LATEST"] }]);
    expectOnlyJsonReads(aws);
  });

  it("ignores a chosen service, Product or region that no Component of the last Scan has, as after a Scan that no longer finds it", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, {
      ...INITIAL_TABLE_STATE,
      filters: { ...NO_FILTERS, services: ["ElastiCache"], products: ["RDS MariaDB"], regions: ["ap-south-1"] },
    });

    expect(groupsOf(view)).toEqual([
      {
        identifiers: [
          "function-9:$LATEST",
          "db-6",
          "db-1",
          "db-2",
          "db-3",
          "function-6:$LATEST",
          "db-4",
          "db-5",
          "function-1:$LATEST",
        ],
      },
    ]);
    expect(view.counts).toEqual({ AWOL: 3, "Falling behind": 2, Current: 3, Untracked: 1 });
    expectOnlyJsonReads(aws);
  });

  it("shows only the Components whose identifier has the search in it, whatever its case, in Urgency order", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "FUNCTION" });

    expect(groupsOf(view)).toEqual([{ identifiers: ["function-9:$LATEST", "function-6:$LATEST", "function-1:$LATEST"] }]);
    expect(view.counts).toEqual({ AWOL: 1, "Falling behind": 0, Current: 1, Untracked: 1 });
    expectOnlyJsonReads(aws);
  });

  it("shows only the Components whose version has the search in it", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "rds.2026" });

    expect(groupsOf(view)).toEqual([{ identifiers: ["db-1"] }]);
    expectOnlyJsonReads(aws);
  });

  it("shows only the Components that have every word of the search in them, each in any of their identifier, version or Release Cycle", async () => {
    const { lastScan, aws } = await scannedAccount();

    const everyWordFound = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "  14 DB  " });
    const wordsInDifferentComponents = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "db python3" });
    const oneWordNowhere = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "db zzz" });

    expect(groupsOf(everyWordFound)).toEqual([{ identifiers: ["db-2", "db-3"] }]);
    expect(groupsOf(wordsInDifferentComponents)).toEqual([]);
    expect(groupsOf(oneWordNowhere)).toEqual([]);
    expectOnlyJsonReads(aws);
  });

  it("matches an Untracked Component with no version on its identifier only", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "python" });

    expect(groupsOf(view)).toEqual([{ identifiers: ["function-9:$LATEST", "function-6:$LATEST"] }]);
    expectOnlyJsonReads(aws);
  });

  it("shows every Component for a search of only whitespace", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "   " });

    expect(view.range).toEqual({ from: 1, to: 9, of: 9 });
    expectOnlyJsonReads(aws);
  });

  it("shows only the Components that pass both the search and the filters, grouped, and counts only those", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, {
      ...INITIAL_TABLE_STATE,
      filters: { ...NO_FILTERS, statuses: ["Falling behind", "Current"] },
      search: "db",
      grouped: true,
    });

    expect(groupsOf(view)).toEqual([
      { product: "RDS PostgreSQL", releaseCycle: "14", identifiers: ["db-2", "db-3"] },
      { product: "RDS PostgreSQL", releaseCycle: "16", identifiers: ["db-4"] },
      { product: "RDS PostgreSQL", releaseCycle: "17", identifiers: ["db-5"] },
    ]);
    expect(view.counts).toEqual({ AWOL: 0, "Falling behind": 2, Current: 2, Untracked: 0 });
    expect(view.range).toEqual({ from: 1, to: 4, of: 4 });
    expectOnlyJsonReads(aws);
  });

  it("sorts the Components that have the search in them on the chosen column", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, search: "function", sort: { column: "version", direction: "descending" } });

    expect(groupsOf(view)).toEqual([{ identifiers: ["function-6:$LATEST", "function-9:$LATEST", "function-1:$LATEST"] }]);
    expectOnlyJsonReads(aws);
  });

  it("groups the Components by Product and Release Cycle, each group where its most urgent Component is, keeping their order inside it", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, grouped: true });

    expect(groupsOf(view)).toEqual([
      { product: "AWS Lambda", releaseCycle: "python3.8", identifiers: ["function-9:$LATEST"] },
      { product: "RDS PostgreSQL", releaseCycle: "13", identifiers: ["db-6"] },
      { product: "RDS MySQL", releaseCycle: "8.0.46", identifiers: ["db-1"] },
      { product: "RDS PostgreSQL", releaseCycle: "14", identifiers: ["db-2", "db-3"] },
      { product: "AWS Lambda", releaseCycle: "python3.12", identifiers: ["function-6:$LATEST"] },
      { product: "RDS PostgreSQL", releaseCycle: "16", identifiers: ["db-4"] },
      { product: "RDS PostgreSQL", releaseCycle: "17", identifiers: ["db-5"] },
      { product: "AWS Lambda", releaseCycle: undefined, identifiers: ["function-1:$LATEST"] },
    ]);
    expect(view.counts).toEqual({ AWOL: 3, "Falling behind": 2, Current: 3, Untracked: 1 });
    expectOnlyJsonReads(aws);
  });

  it("sorts by version number, with no version last", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, sort: { column: "version", direction: "ascending" } });

    expect(groupsOf(view)).toEqual([
      {
        identifiers: [
          "db-1",
          "db-6",
          "db-2",
          "db-3",
          "db-4",
          "db-5",
          "function-9:$LATEST",
          "function-6:$LATEST",
          "function-1:$LATEST",
        ],
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("sorts by date, latest first, with no date still last and Components on the same date in Urgency order", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, sort: { column: "endOfLife", direction: "descending" } });

    expect(groupsOf(view)).toEqual([
      {
        identifiers: [
          "db-5",
          "db-4",
          "function-6:$LATEST",
          "db-2",
          "db-3",
          "db-1",
          "db-6",
          "function-9:$LATEST",
          "function-1:$LATEST",
        ],
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("sorts by text alphabetically, keeping Urgency order within each value", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, sort: { column: "region", direction: "ascending" } });

    expect(groupsOf(view)).toEqual([
      {
        identifiers: [
          "function-9:$LATEST",
          "db-1",
          "db-2",
          "db-3",
          "function-6:$LATEST",
          "db-4",
          "db-5",
          "db-6",
          "function-1:$LATEST",
        ],
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("sorts by Release Cycle number, with no Release Cycle last", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, sort: { column: "releaseCycle", direction: "ascending" } });

    expect(groupsOf(view)).toEqual([
      {
        identifiers: [
          "db-1",
          "db-6",
          "db-2",
          "db-3",
          "db-4",
          "db-5",
          "function-9:$LATEST",
          "function-6:$LATEST",
          "function-1:$LATEST",
        ],
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("sorts by Status in Status order, or in reverse, keeping Urgency order within each Status", async () => {
    const { lastScan, aws } = await scannedAccount();

    const ascending = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, sort: { column: "status", direction: "ascending" } });
    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, sort: { column: "status", direction: "descending" } });

    expect(groupsOf(ascending)).toEqual(groupsOf(dashboardViewOf(lastScan, INITIAL_TABLE_STATE)));
    expect(groupsOf(view)).toEqual([
      {
        identifiers: [
          "function-1:$LATEST",
          "function-6:$LATEST",
          "db-4",
          "db-5",
          "db-2",
          "db-3",
          "function-9:$LATEST",
          "db-6",
          "db-1",
        ],
      },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("sorts on a column ascending, then descending, then in Urgency order again, and on another column ascending", () => {
    const ascending = nextSort(undefined, "endOfLife");
    const descending = nextSort(ascending, "endOfLife");

    expect(ascending).toEqual({ column: "endOfLife", direction: "ascending" });
    expect(descending).toEqual({ column: "endOfLife", direction: "descending" });
    expect(nextSort(descending, "endOfLife")).toBeUndefined();
    expect(nextSort(descending, "region")).toEqual({ column: "region", direction: "ascending" });
  });

  it("sorts the Components inside each group, each group where its first Component is", async () => {
    const { lastScan, aws } = await scannedAccount();

    const view = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, grouped: true, sort: { column: "version", direction: "descending" } });

    expect(groupsOf(view)).toEqual([
      { product: "AWS Lambda", releaseCycle: "python3.12", identifiers: ["function-6:$LATEST"] },
      { product: "AWS Lambda", releaseCycle: "python3.8", identifiers: ["function-9:$LATEST"] },
      { product: "RDS PostgreSQL", releaseCycle: "17", identifiers: ["db-5"] },
      { product: "RDS PostgreSQL", releaseCycle: "16", identifiers: ["db-4"] },
      { product: "RDS PostgreSQL", releaseCycle: "14", identifiers: ["db-3", "db-2"] },
      { product: "RDS PostgreSQL", releaseCycle: "13", identifiers: ["db-6"] },
      { product: "RDS MySQL", releaseCycle: "8.0.46", identifiers: ["db-1"] },
      { product: "AWS Lambda", releaseCycle: undefined, identifiers: ["function-1:$LATEST"] },
    ]);
    expectOnlyJsonReads(aws);
  });

  // function-from:$LATEST to function-to:$LATEST.
  function functionsFrom(from: number, to: number): string[] {
    return Array.from({ length: to - from + 1 }, (_, i) => `function-${from + i}:$LATEST`);
  }

  it("shows one page of Components, and counts every Component that passes the filters", async () => {
    // 39 Components: function-9:$LATEST, db-6, db-1, db-2, db-3,
    // function-6:$LATEST, function-11:$LATEST to function-40:$LATEST, db-4,
    // db-5 and function-1:$LATEST.
    const { lastScan, aws } = await scannedAccount(30);

    const first = dashboardViewOf(lastScan, INITIAL_TABLE_STATE);
    const second = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, page: { index: 1, size: 25 } });

    expect(groupsOf(first)).toEqual([
      { identifiers: ["function-9:$LATEST", "db-6", "db-1", "db-2", "db-3", "function-6:$LATEST", ...functionsFrom(11, 29)] },
    ]);
    expect(first).toMatchObject({ page: 0, pages: 2, range: { from: 1, to: 25, of: 39 } });
    expect(groupsOf(second)).toEqual([{ identifiers: [...functionsFrom(30, 40), "db-4", "db-5", "function-1:$LATEST"] }]);
    expect(second).toMatchObject({ page: 1, pages: 2, range: { from: 26, to: 39, of: 39 } });
    expect(second.counts).toEqual({ AWOL: 3, "Falling behind": 2, Current: 33, Untracked: 1 });
    expectOnlyJsonReads(aws);
  });

  it("shows the last page for a page past it, as after a Scan that finds fewer Components", async () => {
    const { lastScan, aws } = await scannedAccount(30);

    const pastTheEnd = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, page: { index: 3, size: 25 } });
    const bigger = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, page: { index: 1, size: 50 } });

    expect(groupsOf(pastTheEnd)).toEqual([{ identifiers: [...functionsFrom(30, 40), "db-4", "db-5", "function-1:$LATEST"] }]);
    expect(pastTheEnd).toMatchObject({ page: 1, pages: 2, range: { from: 26, to: 39, of: 39 } });
    expect(groupsOf(bigger)[0]!.identifiers).toHaveLength(39);
    expect(bigger).toMatchObject({ page: 0, pages: 1, range: { from: 1, to: 39, of: 39 } });
    expectOnlyJsonReads(aws);
  });

  it("shows a group that goes on past its page again on the next, with all of its Components counted on both", async () => {
    const { lastScan, aws } = await scannedAccount(30);

    const first = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, grouped: true });
    const second = dashboardViewOf(lastScan, { ...INITIAL_TABLE_STATE, grouped: true, page: { index: 1, size: 25 } });

    const groupsCounted = (view: DashboardView) =>
      view.groups.map(({ releaseCycle, count, components }) => ({ releaseCycle, count, identifiers: components.map(({ identifier }) => identifier) }));
    expect(groupsCounted(first).at(-1)).toEqual({ releaseCycle: "python3.12", count: 31, identifiers: ["function-6:$LATEST", ...functionsFrom(11, 29)] });
    expect(groupsCounted(second)).toEqual([
      { releaseCycle: "python3.12", count: 31, identifiers: functionsFrom(30, 40) },
      { releaseCycle: "16", count: 1, identifiers: ["db-4"] },
      { releaseCycle: "17", count: 1, identifiers: ["db-5"] },
      { releaseCycle: undefined, count: 1, identifiers: ["function-1:$LATEST"] },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("offers to filter on the services, Products and regions of the last Scan's Components, in alphabetical order, and on every Status", async () => {
    const { lastScan, aws } = await scannedAccount();

    expect(filterOptionsOf(lastScan)).toEqual({
      services: ["Lambda", "RDS"],
      products: ["AWS Lambda", "RDS MySQL", "RDS PostgreSQL"],
      regions: ["eu-west-1", "us-east-1"],
      statuses: ["AWOL", "Falling behind", "Current", "Untracked"],
    });
    expectOnlyJsonReads(aws);
  });
});

// The regions `aws` made the call `service subcommand` in, each once, in
// order.
function regionsCalled(aws: { calls: string[][] }, call: string): string[] {
  const regions = aws.calls
    .filter(([service, subcommand]) => `${service} ${subcommand}` === call)
    .map((argv) => argv[argv.indexOf("--region") + 1]!);
  return [...new Set(regions)].sort();
}

describe("Discovery", () => {
  const LATER = new Date("2026-11-04T08:30:00Z");

  // The page's Discovery on `now`.
  async function discovery(aws: AwsRunner, now = NOW): Promise<DiscoveryResult> {
    const model = await awol(aws, now).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return model.discovery!;
  }

  // Each service Discovery found resources of, with how many in all and in
  // each region.
  function found({ services }: DiscoveryResult) {
    return services.filter(({ count }) => count > 0).map(({ service, count, regions }) => ({ service, count, regions }));
  }

  it("lists the enabled regions, then counts each service's resources in each of them", async () => {
    const aws = account({
      functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }, { latest: lambdaFunction("function-7") }] },
    });

    expect(await awol(aws).discover()).toMatchObject({ kind: "discovered" });

    const result = await discovery(aws);
    expect(result).toMatchObject({
      startedAt: "2026-11-03T12:00:00.000Z",
      finishedAt: "2026-11-03T12:00:00.000Z",
      regions: ENABLED_REGIONS,
      failedParts: [],
    });
    expect(found(result)).toEqual([
      { service: "RDS", count: 5, regions: [{ region: "eu-west-1", count: 5 }] },
      { service: "Lambda", count: 2, regions: [{ region: "us-east-1", count: 2 }] },
    ]);
    for (const call of [
      "rds describe-db-instances",
      "rds describe-db-clusters",
      "elasticache describe-replication-groups",
      "elasticache describe-cache-clusters",
      "elasticache describe-serverless-caches",
      "opensearch list-domain-names",
      "lambda list-functions",
      ...Object.keys(UNMONITORED_CALLS),
    ]) {
      expect(regionsCalled(aws, call), call).toEqual(ENABLED_REGIONS);
    }
    expectOnlyJsonReads(aws);
  });

  it("reads the versions of each supported service where it has resources, and nowhere else", async () => {
    const aws = account({
      clusters: { "eu-west-1": CLUSTERS },
      functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }, { latest: lambdaFunction("function-1") }] },
    });

    await awol(aws).discover();

    const versions = Object.fromEntries((await discovery(aws)).services.map(({ service, count, versions }) => [service, { count, versions }]));
    expect(versions.RDS).toEqual({
      count: 6,
      versions: [
        { product: "RDS MySQL", version: "8.0.46-rds.20260624", count: 1 },
        { product: "RDS PostgreSQL", version: "14.19", count: 1 },
        { product: "RDS PostgreSQL", version: "14.22", count: 1 },
        { product: "RDS PostgreSQL", version: "16.13", count: 2 },
        { product: "RDS PostgreSQL", version: "17.9", count: 1 },
      ],
    });
    expect(versions.Aurora).toEqual({
      count: 2,
      versions: [
        { product: "Aurora MySQL", version: "8.0.mysql_aurora.3.04.0", count: 1 },
        { product: "Aurora PostgreSQL", version: "15.4", count: 1 },
      ],
    });
    expect(versions.Lambda).toEqual({
      count: 2,
      versions: [
        { product: "AWS Lambda", version: "python3.12", count: 1 },
        { product: "AWS Lambda", count: 1 },
      ],
    });
    expect(versions["ElastiCache Redis OSS"]).toEqual({ count: 0, versions: [] });
    expect(versions["OpenSearch Service"]).toEqual({ count: 0, versions: [] });
    expect(regionsCalled(aws, "rds describe-db-clusters")).toEqual(ENABLED_REGIONS);
    expect(regionsCalled(aws, "lambda list-aliases")).toEqual(["us-east-1"]);
    expectOnlyJsonReads(aws);
  });

  it("reads only versions, none of AWS's support dates or offered versions, so a denied call for those fails no part", async () => {
    const aws = fakeAws({
      ...accountAnswers({
        replicationGroups: { "eu-west-1": [replicationGroup("group-4").group] },
        cacheClusters: { "eu-west-1": replicationGroup("group-4").members },
        domains: { "eu-west-1": [domain("domain-1")] },
      }),
      [listVersionsIn("eu-west-1")]: { stderr: awsErrors.accessDenied },
      [describeMajorVersionsIn("eu-west-1", "postgres")]: { stderr: awsErrors.accessDenied },
    });

    await awol(aws).discover();

    const result = await discovery(aws);
    expect(result.failedParts).toEqual([]);
    expect(result.services.find(({ service }) => service === "OpenSearch Service")!.versions).toEqual([
      { product: "OpenSearch", version: "OpenSearch_2.11", count: 1 },
    ]);
    expect(result.services.find(({ service }) => service === "ElastiCache Redis OSS")!.versions).toEqual([
      { product: "ElastiCache Redis OSS", version: "7.1.0", count: 1 },
    ]);
    for (const call of [
      "rds describe-db-major-engine-versions",
      "rds describe-db-engine-versions",
      "elasticache describe-cache-engine-versions",
      "opensearch list-versions",
    ]) {
      expect(regionsCalled(aws, call), call).toEqual([]);
    }
    expectOnlyJsonReads(aws);
  });

  it("counts the services awol cannot monitor yet as not supported, those from supported services' calls included, reading none of their versions", async () => {
    const aws = account({
      instances: {
        "eu-west-1": [
          instance("db-6"),
          instance("db-7", { Engine: "oracle-ee", EngineVersion: "19.0.0.0.ru-2025-10.rur-2025-10.r1" }),
          instance("db-8", { Engine: "sqlserver-se", EngineVersion: "15.00.4430.1.v1" }),
        ],
      },
      // The retired engine of Aurora MySQL 1, which awol does not read,
      // counts as no service.
      clusters: { "eu-west-1": [...CLUSTERS, cluster("cluster-2", { DBClusterIdentifier: "cluster-6", Engine: "aurora", EngineVersion: "5.6.10a" })] },
      replicationGroups: { "eu-west-1": REPLICATION_GROUPS },
      cacheClusters: { "eu-west-1": CACHE_CLUSTERS },
      serverlessCaches: { "eu-west-1": SERVERLESS_CACHES },
      unmonitored: { "eu-west-1": UNMONITORED },
    });

    await awol(aws).discover();

    const { services } = await discovery(aws);
    expect(services.map(({ service, supported, count }) => ({ service, supported, count }))).toEqual([
      { service: "RDS", supported: true, count: 2 },
      { service: "Aurora", supported: true, count: 2 },
      { service: "ElastiCache Redis OSS", supported: true, count: 6 },
      { service: "OpenSearch Service", supported: true, count: 0 },
      { service: "Lambda", supported: true, count: 0 },
      { service: "EKS", supported: false, count: 2 },
      { service: "MSK", supported: false, count: 1 },
      { service: "DocumentDB", supported: false, count: 1 },
      { service: "Neptune", supported: false, count: 1 },
      { service: "Amazon MQ", supported: false, count: 1 },
      { service: "ElastiCache Valkey", supported: false, count: 2 },
      { service: "ElastiCache Memcached", supported: false, count: 1 },
      { service: "MemoryDB", supported: false, count: 1 },
      { service: "Elastic Beanstalk", supported: false, count: 2 },
      { service: "RDS Oracle", supported: false, count: 1 },
      { service: "RDS SQL Server", supported: false, count: 1 },
      { service: "EC2", supported: false, count: 2 },
    ]);
    expect(services.find(({ service }) => service === "ElastiCache Redis OSS")!.versions).toEqual([
      { product: "ElastiCache Redis OSS", version: "5.0.6", count: 2 },
      { product: "ElastiCache Redis OSS", version: "6.2.6", count: 1 },
      { product: "ElastiCache Redis OSS", version: "7.0.7", count: 1 },
      { product: "ElastiCache Redis OSS", version: "7.1", count: 1 },
      { product: "ElastiCache Redis OSS", version: "7.1.0", count: 1 },
    ]);
    for (const { service, supported, versions } of services) {
      if (!supported) expect(versions, service).toEqual([]);
    }
    expectOnlyJsonReads(aws);
  });

  it("shows a service with no endpoint in a region as not in that region, not as a part that failed", async () => {
    const aws = fakeAws({
      ...accountAnswers(),
      [unmonitoredIn("sa-east-1", "memorydb describe-clusters")]: {
        stderr: awsErrors.notAvailable.replace("rds.eu-west-1", "memory-db.sa-east-1"),
      },
    });

    await awol(aws).discover();

    const result = await discovery(aws);
    expect(result.failedParts).toEqual([]);
    expect(result.services.find(({ service }) => service === "MemoryDB")).toMatchObject({ count: 0, notInRegions: ["sa-east-1"] });
    expect(result.services.find(({ service }) => service === "EKS")).toMatchObject({ count: 0, notInRegions: [] });
    expectOnlyJsonReads(aws);
  });

  it("records a part that fails with its error and reads the rest", async () => {
    const aws = fakeAws({
      ...accountAnswers({
        clusters: { "eu-west-1": [cluster("cluster-1")] },
        functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }] },
        unmonitored: { "eu-west-1": UNMONITORED },
      }),
      [describeDbInstancesIn("eu-west-1")]: { stderr: awsErrors.accessDenied },
      [listAliasesIn("us-east-1", "function-6")]: { stderr: awsErrors.throttling },
    });

    expect(await awol(aws).discover()).toMatchObject({ kind: "discovered" });

    const result = await discovery(aws);
    expect(result.finishedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(result.failedParts).toEqual([
      { part: { kind: "presence", awsService: "RDS", region: "eu-west-1" }, error: awsErrors.accessDenied.trim() },
      { part: { kind: "versions", service: "Lambda", region: "us-east-1" }, error: awsErrors.throttling.trim() },
    ]);
    expect(found(result)).toEqual([
      { service: "Lambda", count: 1, regions: [{ region: "us-east-1", count: 1 }] },
      { service: "EKS", count: 2, regions: [{ region: "eu-west-1", count: 2 }] },
      { service: "MSK", count: 1, regions: [{ region: "eu-west-1", count: 1 }] },
      { service: "Amazon MQ", count: 1, regions: [{ region: "eu-west-1", count: 1 }] },
      { service: "MemoryDB", count: 1, regions: [{ region: "eu-west-1", count: 1 }] },
      { service: "Elastic Beanstalk", count: 2, regions: [{ region: "eu-west-1", count: 2 }] },
      { service: "EC2", count: 2, regions: [{ region: "eu-west-1", count: 2 }] },
    ]);
    expect(result.services.find(({ service }) => service === "Lambda")!.versions).toEqual([]);
    expectOnlyJsonReads(aws);
  });

  it("keeps a part's previous result when it fails on the next Discovery, Stale since its last successful read", async () => {
    const before = account({ unmonitored: { "eu-west-1": UNMONITORED } });
    await awol(before, NOW).discover();
    // db-1 has gone and an EKS cluster has been added, but RDS fails in
    // eu-west-1, for its resources and their versions alike.
    const after = fakeAws({
      ...accountAnswers({
        instances: { "eu-west-1": describeDbInstances.DBInstances.slice(1) },
        unmonitored: { "eu-west-1": { ...UNMONITORED, "eks list-clusters": { clusters: ["eks-1", "eks-2", "eks-3"] } } },
      }),
      [describeDbClustersIn("eu-west-1")]: { stderr: awsErrors.throttling },
    });

    await awol(after, LATER).discover();

    const result = await discovery(after, LATER);
    expect(result.failedParts).toEqual([
      {
        part: { kind: "presence", awsService: "RDS", region: "eu-west-1" },
        error: awsErrors.throttling.trim(),
        lastReadAt: "2026-11-03T12:00:00.000Z",
      },
      {
        part: { kind: "versions", service: "RDS", region: "eu-west-1" },
        error: awsErrors.throttling.trim(),
        lastReadAt: "2026-11-03T12:00:00.000Z",
      },
    ]);
    expect(result.services.find(({ service }) => service === "RDS")!.versions).toHaveLength(5);
    expect(found(result).slice(0, 2)).toEqual([
      { service: "RDS", count: 5, regions: [{ region: "eu-west-1", count: 5, stale: { lastReadAt: "2026-11-03T12:00:00.000Z" } }] },
      { service: "EKS", count: 3, regions: [{ region: "eu-west-1", count: 3 }] },
    ]);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });

  it("re-reads only the failed or Stale parts when asked to, keeping every other part as it was", async () => {
    const THEN = new Date("2026-11-05T09:00:00Z");
    const notInRegion = { stderr: awsErrors.notAvailable.replace("rds.eu-west-1", "memory-db.sa-east-1") };
    // Lambda can never be read in eu-west-2, and MemoryDB has no endpoint in
    // sa-east-1.
    const first = fakeAws({
      ...accountAnswers(),
      [listFunctionsIn("eu-west-2")]: { stderr: awsErrors.accessDenied },
      [unmonitoredIn("sa-east-1", "memorydb describe-clusters")]: notInRegion,
    });
    await awol(first, NOW).discover();
    // RDS fails in eu-west-1 too, so is Stale there.
    const second = fakeAws({
      ...accountAnswers(),
      [listFunctionsIn("eu-west-2")]: { stderr: awsErrors.accessDenied },
      [unmonitoredIn("sa-east-1", "memorydb describe-clusters")]: notInRegion,
      [describeDbInstancesIn("eu-west-1")]: { stderr: awsErrors.throttling },
    });
    await awol(second, LATER).discover();
    expect((await discovery(second, LATER)).failedParts.map(({ part }) => part)).toEqual([
      { kind: "presence", awsService: "RDS", region: "eu-west-1" },
      { kind: "presence", awsService: "Lambda", region: "eu-west-2" },
      { kind: "versions", service: "RDS", region: "eu-west-1" },
    ]);
    const third = fakeAws({
      ...accountAnswers({ functions: { "eu-west-2": [{ latest: lambdaFunction("function-6") }] } }),
      [unmonitoredIn("sa-east-1", "memorydb describe-clusters")]: notInRegion,
    });

    expect(await awol(third, THEN).discover({ scope: "failed" })).toMatchObject({ kind: "discovered" });

    expect(third.calls.map((argv) => argv.join(" ")).sort()).toEqual(
      [
        CALLER_IDENTITY,
        describeDbInstancesIn("eu-west-1"),
        describeDbClustersIn("eu-west-1"),
        describeDbInstancesIn("eu-west-1"),
        describeDbClustersIn("eu-west-1"),
        listFunctionsIn("eu-west-2"),
        listFunctionsIn("eu-west-2"),
        listAliasesIn("eu-west-2", "function-6"),
      ].sort(),
    );
    const result = await discovery(third, THEN);
    expect(result).toMatchObject({ startedAt: "2026-11-05T09:00:00.000Z", finishedAt: "2026-11-05T09:00:00.000Z", failedParts: [] });
    expect(found(result)).toEqual([
      { service: "RDS", count: 5, regions: [{ region: "eu-west-1", count: 5 }] },
      { service: "Lambda", count: 1, regions: [{ region: "eu-west-2", count: 1 }] },
    ]);
    expect(result.services.find(({ service }) => service === "MemoryDB")!.notInRegions).toEqual(["sa-east-1"]);
    expectOnlyJsonReads(first);
    expectOnlyJsonReads(second);
    expectOnlyJsonReads(third);
  });

  it("reads every part again on a full Discovery", async () => {
    const before = account();
    await awol(before, NOW).discover();
    const after = account();

    await awol(after, LATER).discover({ scope: "all" });

    expect(after.calls.filter(([, subcommand]) => subcommand === "list-regions")).toHaveLength(1);
    expect(regionsCalled(after, "eks list-clusters")).toEqual(ENABLED_REGIONS);
    // Once for RDS's resources there, and once for their versions.
    expect(after.calls.filter((argv) => argv.join(" ") === describeDbInstancesIn("eu-west-1"))).toHaveLength(2);
    expect(await discovery(after, LATER)).toMatchObject({ startedAt: "2026-11-04T08:30:00.000Z", failedParts: [] });
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });

  it("re-reads a region's versions with its re-read failed or Stale part, so the two never disagree", async () => {
    const THEN = new Date("2026-11-05T09:00:00Z");
    const before = account();
    await awol(before, NOW).discover();
    // db-1 has gone. RDS fails once in eu-west-1, counting its resources,
    // then answers when its versions are read.
    const recorded = account({ instances: { "eu-west-1": describeDbInstances.DBInstances.slice(1) } });
    let failed = false;
    const once = Object.assign(
      async (argv: string[]) => {
        if (failed || argv.join(" ") !== describeDbInstancesIn("eu-west-1")) return recorded(argv);
        failed = true;
        recorded.calls.push(argv);
        throw awsCliError(argv, awsErrors.throttling);
      },
      { calls: recorded.calls },
    );
    await awol(once, LATER).discover();
    const rds = (result: DiscoveryResult) => result.services.find(({ service }) => service === "RDS")!;
    expect(rds(await discovery(once, LATER))).toMatchObject({ count: 5, versions: { length: 4 } });
    // db-2 has gone too.
    const after = account({ instances: { "eu-west-1": describeDbInstances.DBInstances.slice(2) } });

    await awol(after, THEN).discover({ scope: "failed" });

    const result = await discovery(after, THEN);
    expect(result.failedParts).toEqual([]);
    expect(rds(result).count).toBe(3);
    expect(rds(result).versions).toEqual([
      { product: "RDS PostgreSQL", version: "14.22", count: 1 },
      { product: "RDS PostgreSQL", version: "16.13", count: 1 },
      { product: "RDS PostgreSQL", version: "17.9", count: 1 },
    ]);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(once);
    expectOnlyJsonReads(after);
  });

  it("tells of each part as soon as it is kept, as the dashboard would show the Discovery then", async () => {
    const aws = account({ unmonitored: { "us-east-1": UNMONITORED } });
    const updates: DiscoveryResult[] = [];

    await awol(aws).discover({ onPart: (result) => updates.push(result) });

    const rds = (result: DiscoveryResult) => result.services.find(({ service }) => service === "RDS")!;
    expect(updates[0]).toMatchObject({ startedAt: "2026-11-03T12:00:00.000Z", regions: [], failedParts: [] });
    expect(updates[0]!.services.every(({ count }) => count === 0)).toBe(true);
    expect(updates.slice(0, -1).every(({ finishedAt }) => finishedAt === undefined)).toBe(true);
    expect(updates.some((result) => result.regions.length === ENABLED_REGIONS.length && rds(result).count === 0)).toBe(true);
    expect(updates.some((result) => rds(result).count === 5 && rds(result).versions.length === 0)).toBe(true);
    expect(updates.at(-1)).toEqual(await discovery(aws));
    expect(updates.at(-1)!.finishedAt).toBe("2026-11-03T12:00:00.000Z");
    expectOnlyJsonReads(aws);
  });

  it("asks to log in again when credentials expire part-way through, leaving the last Discovery as it was", async () => {
    const before = account();
    await awol(before, NOW).discover();
    const kept = await discovery(before);
    const after = fakeAws({
      ...accountAnswers({ unmonitored: { "us-east-1": UNMONITORED } }),
      [describeDbInstancesIn("eu-west-1")]: { stderr: credentialErrors.expiredToken },
    });

    expect(await awol(after, LATER).discover()).toEqual({ kind: "login-needed", reason: credentialErrors.expiredToken.trim() });

    expect(await discovery(before)).toEqual(kept);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });
});

describe("Monitored services", () => {
  // The page on `now`, signed in.
  async function page(aws: AwsRunner, now = NOW) {
    const model = await awol(aws, now).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return model;
  }

  it("starts with Discovery instead of a Scan for an account awol has not seen, monitoring nothing yet", async () => {
    const aws = account({ functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }] } });

    expect(await awol(aws).start()).toMatchObject({ kind: "discovered" });

    const model = await page(aws);
    expect(model.discovery).toMatchObject({ finishedAt: "2026-11-03T12:00:00.000Z", failedParts: [] });
    expect(model.monitoredServices).toBeUndefined();
    expect(model.lastScan).toBeUndefined();
    expectOnlyJsonReads(aws);
  });

  it("must be chosen before a Scan reads anything, on start as on request", async () => {
    const discovered = account();
    await awol(discovered).start();
    const aws = account();

    expect(await awol(aws).start()).toEqual({ kind: "monitored-services-needed" });
    expect(await awol(aws).scan()).toEqual({ kind: "monitored-services-needed" });

    expect(aws.calls.map((argv) => argv.join(" "))).toEqual([CALLER_IDENTITY, CALLER_IDENTITY]);
    expect((await page(aws)).lastScan).toBeUndefined();
    expectOnlyJsonReads(discovered);
    expectOnlyJsonReads(aws);
  });

  // An account with Components of every supported service: five RDS
  // instances in eu-west-1, and an Aurora PostgreSQL cluster, a Redis OSS
  // replication group, an OpenSearch domain and an aliased Lambda function in
  // us-east-1.
  function everyService() {
    return account({
      clusters: { "us-east-1": [cluster("cluster-1")] },
      replicationGroups: { "us-east-1": [replicationGroup("group-4").group] },
      cacheClusters: { "us-east-1": replicationGroup("group-4").members },
      domains: { "us-east-1": [domain("domain-1")] },
      functions: { "us-east-1": [{ latest: lambdaFunction("function-6"), aliases: [ALIASES[0]!] }] },
    });
  }

  // Each call `aws` made, without its options.
  function callsMade(aws: { calls: string[][] }): string[] {
    return [...new Set(aws.calls.map(([service, subcommand]) => `${service} ${subcommand}`))].sort();
  }

  it("limit a Scan to their Components, reading nothing more of the services not monitored", async () => {
    const aws = everyService();
    await awol(aws).start();
    await awol(aws).setMonitoredServices(["RDS"]);
    aws.calls.length = 0;

    expect(await awol(aws).start()).toMatchObject({ kind: "scanned" });

    const { lastScan } = await page(aws);
    expect(lastScan!.components.map(({ product, identifier }) => `${product} ${identifier}`).sort()).toEqual([
      "RDS MySQL db-1",
      "RDS PostgreSQL db-2",
      "RDS PostgreSQL db-3",
      "RDS PostgreSQL db-4",
      "RDS PostgreSQL db-5",
    ]);
    expect(lastScan!.failedParts).toEqual([]);
    for (const call of [
      "rds describe-db-instances",
      "rds describe-db-clusters",
      "rds describe-db-major-engine-versions",
      "rds describe-db-engine-versions",
    ]) {
      expect(callsMade(aws), call).toContain(call);
    }
    for (const call of ["elasticache describe-cache-engine-versions", "opensearch describe-domains", "opensearch list-versions", "lambda list-aliases"]) {
      expect(callsMade(aws), call).not.toContain(call);
    }
    expect(aws.calls.filter((argv) => argv.includes("aurora-postgresql"))).toEqual([]);
    expectOnlyJsonReads(aws);
  });

  it("leave out a service no longer monitored even where its part of the Scan fails and is Stale", async () => {
    const LATER = new Date("2026-11-04T08:30:00Z");
    const contents = { instances: {}, clusters: { "us-east-1": [cluster("cluster-1"), cluster("cluster-3")] } };
    const before = account(contents);
    await awol(before).start();
    await awol(before).setMonitoredServices(["RDS", "Aurora"]);
    await awol(before).scan();
    expect((await page(before)).lastScan!.components.map(({ identifier }) => identifier).sort()).toEqual(["cluster-1", "cluster-3"]);
    await awol(before).setMonitoredServices(["RDS"]);
    const after = fakeAws({ ...accountAnswers(contents), [describeDbClustersIn("us-east-1")]: { stderr: awsErrors.throttling } });

    await awol(after, LATER).scan();

    const { lastScan } = await page(after, LATER);
    expect(lastScan!.components.map(({ identifier, stale }) => ({ identifier, stale }))).toEqual([
      { identifier: "cluster-3", stale: { lastReadAt: "2026-11-03T12:00:00.000Z" } },
    ]);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });

  it("leave out the last Scan's Components of a service as soon as it is no longer monitored, noting its resources instead", async () => {
    const latest = lambdaFunction("function-6");
    // function-6 is two Components, its $LATEST and version 9, which an
    // alias points to, but one resource.
    const aws = account({
      instances: {},
      clusters: { "us-east-1": [cluster("cluster-1"), cluster("cluster-3")] },
      functions: {
        "us-east-1": [{ latest, aliases: [ALIASES[3]!], versions: [{ ...latest, Version: "9", Runtime: "python3.9" }] }],
      },
    });
    await awol(aws).start();
    await awol(aws).setMonitoredServices(["RDS", "Lambda"]);
    await awol(aws).scan();
    expect((await page(aws)).lastScan!.components.map(({ identifier }) => identifier).sort()).toEqual([
      "cluster-3",
      "function-6:$LATEST",
      "function-6:9",
    ]);

    await awol(aws).setMonitoredServices(["Aurora"]);

    const { lastScan } = await page(aws);
    expect(lastScan!.components).toEqual([]);
    expect(lastScan!.counts).toEqual({ AWOL: 0, "Falling behind": 0, Current: 0, Untracked: 0 });
    expect(lastScan!.unmonitoredServices).toEqual([
      { service: "RDS", count: 1 },
      { service: "Lambda", count: 1 },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("show a Scan kept before awol had Monitored services whole, as it read every service, while none are chosen", async () => {
    const aws = account();
    await scanAll(aws);
    const shown = (await page(aws)).lastScan;
    // The same Scan as awol kept it before: with no Monitored services.
    const statePath = path.join(dir, "accounts", "123456789012", "state.json");
    const { monitoredServices: _, ...kept } = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(statePath, JSON.stringify(kept));

    const model = await page(aws);
    expect(model.monitoredServices).toBeUndefined();
    expect(model.lastScan).toEqual(shown);
    expect(model.lastScan!.components).toHaveLength(5);
    expectOnlyJsonReads(aws);
  });

  it("can be left unchosen by a Scan of every supported service, shown whole, which ends in the last Scan as the dashboard shows it", async () => {
    const aws = everyService();
    await awol(aws).start();

    const outcome = await awol(aws).scan({ readEverySupportedService: true });

    const model = await page(aws);
    expect(outcome).toEqual({ kind: "scanned", lastScan: model.lastScan });
    expect(model.monitoredServices).toBeUndefined();
    expect(model.lastScan!.components.map(({ product, identifier }) => `${product} ${identifier}`).sort()).toEqual([
      "AWS Lambda function-6:$LATEST",
      "Aurora PostgreSQL cluster-1",
      "ElastiCache Redis OSS group-4",
      "OpenSearch domain-1",
      "RDS MySQL db-1",
      "RDS PostgreSQL db-2",
      "RDS PostgreSQL db-3",
      "RDS PostgreSQL db-4",
      "RDS PostgreSQL db-5",
    ]);
    expectOnlyJsonReads(aws);
  });

  it("limit a Scan asked to read every supported service once they are chosen", async () => {
    const aws = everyService();
    await awol(aws).start();
    await awol(aws).setMonitoredServices(["Lambda"]);

    await awol(aws).scan({ readEverySupportedService: true });

    const model = await page(aws);
    expect(model.monitoredServices).toEqual(["Lambda"]);
    expect(model.lastScan!.components.map(({ identifier }) => identifier)).toEqual(["function-6:$LATEST"]);
    expectOnlyJsonReads(aws);
  });

  it("note each supported service a Scan finds resources of that is not monitored, never adding it", async () => {
    const aws = account({
      clusters: { "us-east-1": [cluster("cluster-1")] },
      functions: {
        "us-east-1": [{ latest: lambdaFunction("function-6"), aliases: [ALIASES[0]!] }],
        "eu-west-2": [{ latest: lambdaFunction("function-7") }],
      },
      unmonitored: { "us-east-1": UNMONITORED },
    });
    await awol(aws).start();
    await awol(aws).setMonitoredServices(["RDS"]);
    aws.calls.length = 0;

    await awol(aws).scan();

    const { monitoredServices, lastScan } = await page(aws);
    expect(lastScan!.unmonitoredServices).toEqual([
      { service: "Aurora", count: 1 },
      { service: "Lambda", count: 2 },
    ]);
    expect(monitoredServices).toEqual(["RDS"]);
    expect(regionsCalled(aws, "lambda list-functions")).toEqual(ENABLED_REGIONS);
    expect(regionsCalled(aws, "opensearch list-domain-names")).toEqual(ENABLED_REGIONS);
    expect(regionsCalled(aws, "elasticache describe-replication-groups")).toEqual(ENABLED_REGIONS);
    for (const call of ["lambda list-aliases", ...Object.keys(UNMONITORED_CALLS)]) {
      expect(callsMade(aws), call).not.toContain(call);
    }
    expectOnlyJsonReads(aws);
  });

  it("keep a note's count that cannot be read on the next Scan, Stale since its last successful read", async () => {
    const LATER = new Date("2026-11-04T08:30:00Z");
    const contents = { functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }] } };
    const before = account(contents);
    await awol(before).start();
    await awol(before).setMonitoredServices(["RDS"]);
    await awol(before).scan();
    const after = fakeAws({ ...accountAnswers(contents), [listFunctionsIn("us-east-1")]: { stderr: awsErrors.throttling } });

    await awol(after, LATER).scan();

    const { lastScan } = await page(after, LATER);
    expect(lastScan!.unmonitoredServices).toEqual([{ service: "Lambda", count: 1 }]);
    expect(lastScan!.failedParts).toEqual([
      {
        part: { kind: "unmonitored", service: "Lambda", region: "us-east-1" },
        error: awsErrors.throttling.trim(),
        lastReadAt: "2026-11-03T12:00:00.000Z",
      },
    ]);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(after);
  });

  it("note nothing when a Scan finds no resources of the supported services not monitored", async () => {
    const aws = account();
    await awol(aws).start();
    await awol(aws).setMonitoredServices(["RDS"]);

    await awol(aws).scan();

    expect((await page(aws)).lastScan!.unmonitoredServices).toEqual([]);
    expectOnlyJsonReads(aws);
  });

  it("are chosen per service after Discovery, Aurora apart from RDS, and can be changed later", async () => {
    const aws = account({ clusters: { "eu-west-1": [cluster("cluster-1")] } });
    await awol(aws).start();

    expect(await awol(aws).setMonitoredServices(["Lambda", "Aurora"])).toEqual({ kind: "saved" });
    expect((await page(aws)).monitoredServices).toEqual(["Aurora", "Lambda"]);

    expect(await awol(aws).setMonitoredServices(["RDS"])).toEqual({ kind: "saved" });
    expect((await page(aws)).monitoredServices).toEqual(["RDS"]);

    expect(await awol(aws).setMonitoredServices([])).toEqual({ kind: "saved" });
    expect((await page(aws)).monitoredServices).toEqual([]);
    expectOnlyJsonReads(aws);
  });

  it("keep each account's Discovery, Monitored services and Scans apart, starting with Discovery on a second account", async () => {
    const first = account();
    await awol(first).start();
    await awol(first).setMonitoredServices(["RDS"]);
    await awol(first).start();
    const kept = await page(first);
    const second = fakeAws({
      ...accountAnswers({ instances: {}, functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }] } }),
      [CALLER_IDENTITY]: SIGNED_IN_ELSEWHERE,
    });

    expect(await awol(second).start()).toMatchObject({ kind: "discovered" });

    const elsewhere = await page(second);
    expect(elsewhere).toMatchObject({ accountId: "210987654321", monitoredServices: undefined, lastScan: undefined });
    expect(elsewhere.discovery!.services.filter(({ count }) => count > 0).map(({ service }) => service)).toEqual(["Lambda"]);
    await awol(second).setMonitoredServices(["Lambda"]);
    expect(await awol(second).start()).toMatchObject({ kind: "scanned" });
    expect((await page(second)).lastScan!.components.map(({ identifier }) => identifier)).toEqual(["function-6:$LATEST"]);

    expect(await page(first)).toEqual(kept);
    expect(kept.lastScan!.components).toHaveLength(5);
    expect(kept.monitoredServices).toEqual(["RDS"]);
    expectOnlyJsonReads(first);
    expectOnlyJsonReads(second);
  });

  it("asks to log in again when credentials have expired, keeping the Monitored services", async () => {
    const aws = account();
    await awol(aws).start();
    await awol(aws).setMonitoredServices(["RDS"]);
    const expired = fakeAws({ [CALLER_IDENTITY]: { stderr: credentialErrors.ssoTokenExpired } });

    expect(await awol(expired).setMonitoredServices(["Lambda"])).toEqual({
      kind: "login-needed",
      reason: credentialErrors.ssoTokenExpired.trim(),
    });

    expect((await page(aws)).monitoredServices).toEqual(["RDS"]);
    expectOnlyJsonReads(aws);
    expectOnlyJsonReads(expired);
  });
});

describe("one Scan or Discovery of an account at a time", () => {
  const STARTED_AT = "2026-11-03T12:00:00.000Z";

  // The page on `now`, signed in.
  async function page(aws: AwsRunner, now = NOW) {
    const model = await awol(aws, now).pageModel();
    if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
    return model;
  }

  // Settles once `condition` holds, checking it every 10ms.
  async function until(condition: () => Promise<boolean>) {
    while (!(await condition())) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // `aws`, holding every call for the account's regions until `release` is
  // called; `reached` settles once one is held.
  function held(aws: AwsRunner & { calls: string[][] }) {
    let release!: () => void;
    let reach!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const runner = async (argv: string[]) => {
      if (argv.join(" ") === LIST_REGIONS) {
        reach();
        await gate;
      }
      return aws(argv);
    };
    return Object.assign(runner, { calls: aws.calls, release, reached });
  }

  it("refuses another, on request or on start, while one runs, saying which runs, since when and who started it", async () => {
    const aws = account();
    await awol(aws).setMonitoredServices(["RDS"]);
    const holding = held(aws);
    const scanning = awol(holding).scan({ startedBy: "awol scan" });
    await holding.reached;
    const running = { operation: "Scan", startedBy: "awol scan", startedAt: STARTED_AT };
    const busy = { kind: "busy", accountId: "123456789012", running, pid: process.pid };

    expect(await awol(aws).discover()).toEqual(busy);
    expect(await awol(aws).scan()).toEqual(busy);
    expect(await awol(aws).start()).toEqual(busy);
    expect((await page(aws)).running).toEqual(running);

    holding.release();
    expect(await scanning).toMatchObject({ kind: "scanned" });
    expect((await page(aws)).running).toBeUndefined();
    expect(await awol(aws).discover({ startedBy: "awol discover" })).toMatchObject({ kind: "discovered" });
    expectOnlyJsonReads(aws);
  });

  it("runs one of each of two accounts at once", async () => {
    const first = account();
    await awol(first).setMonitoredServices(["RDS"]);
    const holding = held(first);
    const scanning = awol(holding).scan();
    await holding.reached;
    const second = fakeAws({ ...accountAnswers(), [CALLER_IDENTITY]: SIGNED_IN_ELSEWHERE });

    expect(await awol(second).discover()).toMatchObject({ kind: "discovered" });

    holding.release();
    expect(await scanning).toMatchObject({ kind: "scanned" });
    expectOnlyJsonReads(first);
    expectOnlyJsonReads(second);
  });

  it("takes over from one whose process is gone, as after a crash", async () => {
    const aws = account();
    await awol(aws).setMonitoredServices(["RDS"]);
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(
      path.join(dir, "accounts", "123456789012", "running.json"),
      JSON.stringify({ operation: "Discovery", startedBy: "awol discover", startedAt: STARTED_AT, pid: gone }),
    );

    expect((await page(aws)).running).toBeUndefined();
    expect(await awol(aws).scan()).toMatchObject({ kind: "scanned" });
    expectOnlyJsonReads(aws);
  });

  it("takes over from one whose lock is corrupt, as after a crash part-way through writing it", async () => {
    const aws = account();
    await awol(aws).setMonitoredServices(["RDS"]);
    await writeFile(path.join(dir, "accounts", "123456789012", "running.json"), '{"operation": "Sc');

    expect((await page(aws)).running).toBeUndefined();
    expect(await awol(aws).scan()).toMatchObject({ kind: "scanned" });
    expect(await readdir(path.join(dir, "accounts", "123456789012"))).toEqual(["state.json"]);
    expectOnlyJsonReads(aws);
  });

  it("cancels a Scan on request at its next part, keeping the last Scan, and frees the account", async () => {
    const aws = account();
    await awol(aws).setMonitoredServices(["RDS"]);
    await awol(aws).scan();
    const before = (await page(aws)).lastScan;
    const holding = held(aws);
    const scanning = awol(holding, new Date("2026-11-04T08:30:00Z")).scan();
    await holding.reached;
    const busy = await awol(aws).discover();
    if (busy.kind !== "busy") throw new Error(`not busy: ${busy.kind}`);

    const cancelling = awol(aws).cancel(busy, 5_000);
    await until(() => readdir(path.join(dir, "accounts", "123456789012")).then((files) => files.includes("cancel.json")));
    holding.release();

    expect(await scanning).toEqual({ kind: "cancelled" });
    expect(await cancelling).toBe(true);
    expect((await page(aws)).lastScan).toEqual(before);
    expect((await page(aws)).running).toBeUndefined();
    expect(await readdir(path.join(dir, "accounts", "123456789012"))).toEqual(["state.json"]);
    expect(await awol(aws).discover()).toMatchObject({ kind: "discovered" });
    expectOnlyJsonReads(aws);
  });

  it("cancels a Discovery on request, leaving the last Discovery as it was", async () => {
    const aws = account();
    await awol(aws).discover();
    const before = (await page(aws)).discovery;
    const holding = held(aws);
    const discovering = awol(holding, new Date("2026-11-04T08:30:00Z")).discover();
    await holding.reached;
    const busy = await awol(aws).scan({ readEverySupportedService: true });
    if (busy.kind !== "busy") throw new Error(`not busy: ${busy.kind}`);

    const cancelling = awol(aws).cancel(busy, 5_000);
    await until(() => readdir(path.join(dir, "accounts", "123456789012")).then((files) => files.includes("cancel.json")));
    holding.release();

    expect(await discovering).toEqual({ kind: "cancelled" });
    expect(await cancelling).toBe(true);
    expect((await page(aws)).discovery).toEqual(before);
    expectOnlyJsonReads(aws);
  });

  it("gives up cancelling one that does not stop in time, leaving no request behind", async () => {
    const aws = account();
    await awol(aws).setMonitoredServices(["RDS"]);
    const holding = held(aws);
    const scanning = awol(holding).scan();
    await holding.reached;
    const busy = await awol(aws).discover();
    if (busy.kind !== "busy") throw new Error(`not busy: ${busy.kind}`);

    expect(await awol(aws).cancel(busy, 200)).toBe(false);
    expect(await readdir(path.join(dir, "accounts", "123456789012"))).not.toContain("cancel.json");

    holding.release();
    expect(await scanning).toMatchObject({ kind: "scanned" });
    expectOnlyJsonReads(aws);
  });

  it("lets the next one run after one ends asking to log in again", async () => {
    const aws = account();
    await awol(aws).setMonitoredServices(["RDS"]);
    const expiring = fakeAws({ ...accountAnswers(), [LIST_REGIONS]: { stderr: credentialErrors.expiredToken } });

    expect(await awol(expiring).scan()).toMatchObject({ kind: "login-needed" });
    expect(await awol(expiring).discover()).toMatchObject({ kind: "login-needed" });

    expect(await awol(aws).scan()).toMatchObject({ kind: "scanned" });
    expectOnlyJsonReads(aws);
    expectOnlyJsonReads(expiring);
  });
});

describe("the progress of a Scan or Discovery", () => {
  // What was told, apart from how many parts are done.
  function told(progress: Progress[]) {
    return progress.filter(({ kind }) => kind !== "parts");
  }

  // How many parts were done of those known, each time either changed.
  function parts(progress: Progress[]) {
    return progress.flatMap((told) => (told.kind === "parts" ? [{ done: told.done, total: told.total }] : []));
  }

  it("tells each step of a Scan once it is done in every region, each part that fails as it fails, and how many parts are done", async () => {
    const aws = fakeAws({
      ...accountAnswers({ functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }] } }),
      [describeDbInstancesIn("eu-west-1")]: { stderr: awsErrors.throttling },
    });
    await awol(aws).setMonitoredServices(["RDS", "Aurora", "Lambda"]);
    const progress: Progress[] = [];

    await awol(aws).scan({ onProgress: (told) => progress.push(told) });

    expect(told(progress)).toEqual([
      { kind: "step-done", step: { kind: "regions" } },
      { kind: "failed", part: { kind: "service", service: "RDS", region: "eu-west-1" }, error: awsErrors.throttling.trim() },
      { kind: "step-done", step: { kind: "scanned", service: "RDS" } },
      { kind: "step-done", step: { kind: "scanned", service: "Lambda" } },
      { kind: "step-done", step: { kind: "endoflife.date" } },
    ]);
    // The regions, then RDS and Lambda read and ElastiCache and OpenSearch
    // counted in each of the 17 regions, then Lambda's one Product.
    const counted = parts(progress);
    expect(counted[0]).toEqual({ done: 0, total: 1 });
    expect(counted.at(-1)).toEqual({ done: 70, total: 70 });
    expect(counted.map(({ total }) => total)).toEqual(counted.map(({ total }) => total).sort((a, b) => a - b));
    expectOnlyJsonReads(aws);
  });

  it("tells every step of a Scan, the Monitored services' and endoflife.date's, even one with no parts, as when it finds no Components", async () => {
    const aws = account({ instances: {} });
    await awol(aws).setMonitoredServices(["RDS"]);
    const progress: Progress[] = [];

    await awol(aws).scan({ onProgress: (told) => progress.push(told) });

    expect(told(progress)).toEqual([
      { kind: "step-done", step: { kind: "regions" } },
      { kind: "step-done", step: { kind: "scanned", service: "RDS" } },
      { kind: "step-done", step: { kind: "endoflife.date" } },
    ]);
    expectOnlyJsonReads(aws);
  });

  it("tells each step of a Discovery once it is done in every region, each part that fails as it fails, and how many parts are done", async () => {
    const aws = fakeAws({
      ...accountAnswers({ functions: { "us-east-1": [{ latest: lambdaFunction("function-6") }] } }),
      [listAliasesIn("us-east-1", "function-6")]: { stderr: awsErrors.throttling },
    });
    const progress: Progress[] = [];

    await awol(aws).discover({ onProgress: (told) => progress.push(told) });

    expect(told(progress).filter(({ kind }) => kind === "step-done")).toEqual([
      { kind: "step-done", step: { kind: "regions" } },
      ...["RDS", "ElastiCache", "OpenSearch", "Lambda", "EKS", "MSK", "Amazon MQ", "MemoryDB", "Elastic Beanstalk", "EC2"].map((awsService) => ({
        kind: "step-done",
        step: { kind: "counted", awsService },
      })),
      { kind: "step-done", step: { kind: "versions", service: "RDS" } },
      { kind: "step-done", step: { kind: "versions", service: "Lambda" } },
    ]);
    expect(told(progress).filter(({ kind }) => kind === "failed")).toEqual([
      { kind: "failed", part: { kind: "versions", service: "Lambda", region: "us-east-1" }, error: awsErrors.throttling.trim() },
    ]);
    // The regions, then 10 AWS services counted in each of the 17 regions,
    // then RDS's versions in eu-west-1 and Lambda's in us-east-1.
    const counted = parts(progress);
    expect(counted[0]).toEqual({ done: 0, total: 1 });
    expect(counted.at(-1)).toEqual({ done: 173, total: 173 });
    expect(counted.map(({ total }) => total)).toEqual(counted.map(({ total }) => total).sort((a, b) => a - b));
    expectOnlyJsonReads(aws);
  });

  it("tells the parts a Discovery of only the failed parts keeps as done, without reading them", async () => {
    const before = fakeAws({ ...accountAnswers(), [describeDbInstancesIn("eu-west-1")]: { stderr: awsErrors.throttling } });
    await awol(before).discover();
    const aws = account();
    const progress: Progress[] = [];

    await awol(aws, new Date("2026-11-04T08:30:00Z")).discover({ scope: "failed", onProgress: (told) => progress.push(told) });

    expect(told(progress).filter(({ kind }) => kind === "failed")).toEqual([]);
    expect(told(progress).filter(({ kind }) => kind === "step-done")).toHaveLength(12);
    // The regions and 10 AWS services in each of the 17 regions, kept but
    // RDS in eu-west-1, and RDS's versions there, read again with it.
    expect(parts(progress).at(-1)).toEqual({ done: 172, total: 172 });
    expect(regionsCalled(aws, "rds describe-db-instances")).toEqual(["eu-west-1"]);
    expect(regionsCalled(aws, "lambda list-functions")).toEqual([]);
    expectOnlyJsonReads(before);
    expectOnlyJsonReads(aws);
  });
});

// The page of an account with `model`'s Discovery, Monitored services, last
// Scan and running Scan or Discovery, and nothing else.
function signedIn(model: Partial<SignedIn> = {}): SignedIn {
  return { kind: "signed-in", accountId: "123456789012", ...model };
}

// A Discovery that started at 08:00 and found nothing, with `result`.
function discovery(result: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return { startedAt: "2026-11-04T08:00:00Z", regions: [], services: [], failedParts: [], ...result };
}

// A Scan at 09:00 that found nothing, with `result`.
function lastScan(result: Partial<LastScan> = {}): LastScan {
  return {
    ranAt: "2026-11-04T09:00:00Z",
    counts: { AWOL: 0, "Falling behind": 0, Current: 0, Untracked: 0 },
    components: [],
    failedParts: [],
    unmonitoredServices: [],
    ...result,
  };
}

describe("the top bar", () => {
  it("shows a Discovery and a Scan that have never run, the Scan waiting for Monitored services", () => {
    expect(topBarOf(signedIn(), false)).toEqual({
      discovery: { lastRun: { kind: "none-yet" }, failedParts: 0, warning: false },
      scan: { lastRun: { kind: "none-yet" }, failedParts: 0, warning: false, blocked: "no-monitored-services" },
    });
  });

  it("shows when the last Discovery finished and the last Scan ran, both ready to run again", () => {
    const model = signedIn({
      discovery: discovery({ finishedAt: "2026-11-04T08:05:00Z" }),
      monitoredServices: ["RDS"],
      lastScan: lastScan(),
    });

    expect(topBarOf(model, false)).toEqual({
      discovery: { lastRun: { kind: "ran", at: "2026-11-04T08:05:00Z" }, failedParts: 0, warning: false },
      scan: { lastRun: { kind: "ran", at: "2026-11-04T09:00:00Z" }, failedParts: 0, warning: false },
    });
  });

  it("marks a Discovery that stopped part-way, with when it started", () => {
    const { discovery: item } = topBarOf(signedIn({ discovery: discovery() }), false);

    expect(item).toEqual({ lastRun: { kind: "stopped-part-way", startedAt: "2026-11-04T08:00:00Z" }, failedParts: 0, warning: true });
  });

  it("marks a Discovery and a Scan with parts that could not be read, Stale or never read, counting them", () => {
    const model = signedIn({
      discovery: discovery({
        finishedAt: "2026-11-04T08:05:00Z",
        failedParts: [
          { part: { kind: "presence", awsService: "RDS", region: "eu-west-1" }, error: "Throttling", lastReadAt: "2026-11-03T08:00:00Z" },
          { part: { kind: "versions", service: "Lambda", region: "us-east-1" }, error: "Throttling" },
        ],
      }),
      monitoredServices: ["RDS"],
      lastScan: lastScan({ failedParts: [{ part: { kind: "regions" }, error: "Throttling" }] }),
    });

    expect(topBarOf(model, false)).toEqual({
      discovery: { lastRun: { kind: "ran", at: "2026-11-04T08:05:00Z" }, failedParts: 2, warning: true },
      scan: { lastRun: { kind: "ran", at: "2026-11-04T09:00:00Z" }, failedParts: 1, warning: true },
    });
  });

  it("shows a running Scan with when and where it started, neither able to run until it ends", () => {
    const running = { operation: "Scan", startedBy: "awol scan", startedAt: "2026-11-04T10:00:00Z" } as const;
    const model = signedIn({ discovery: discovery({ finishedAt: "2026-11-04T08:05:00Z" }), monitoredServices: ["RDS"], lastScan: lastScan(), running });

    expect(topBarOf(model, false)).toEqual({
      discovery: { lastRun: { kind: "ran", at: "2026-11-04T08:05:00Z" }, failedParts: 0, warning: false, blocked: "busy" },
      scan: { lastRun: { kind: "running", run: running }, failedParts: 0, warning: false, blocked: "busy" },
    });
  });

  it("shows a Discovery this server runs as running before it holds the account's lock, not as stopped part-way", () => {
    const model = signedIn({ discovery: discovery(), monitoredServices: ["RDS"] });

    expect(topBarOf(model, true)).toEqual({
      discovery: { lastRun: { kind: "running" }, failedParts: 0, warning: false, blocked: "busy" },
      scan: { lastRun: { kind: "none-yet" }, failedParts: 0, warning: false, blocked: "busy" },
    });
  });

  it("shows who started a running Discovery and when, once it holds the account's lock", () => {
    const running = { operation: "Discovery", startedBy: "the dashboard", startedAt: "2026-11-04T10:00:00Z" } as const;

    const { discovery: item } = topBarOf(signedIn({ discovery: discovery(), running }), true);

    expect(item.lastRun).toEqual({ kind: "running", run: running });
  });

  it("asks for Monitored services over waiting, for a Scan before any are chosen", () => {
    const { scan } = topBarOf(signedIn(), true);

    expect(scan.blocked).toBe("no-monitored-services");
  });
});

describe("the dashboard before its first Scan", () => {
  it("points to a Discovery when none has run", () => {
    expect(nextStepOf(signedIn())).toBe("discover");
  });

  it("points to choosing Monitored services after a Discovery", () => {
    expect(nextStepOf(signedIn({ discovery: discovery({ finishedAt: "2026-11-04T08:05:00Z" }) }))).toBe("choose-monitored-services");
  });

  it("points to a Scan once Monitored services are chosen", () => {
    const model = signedIn({ discovery: discovery({ finishedAt: "2026-11-04T08:05:00Z" }), monitoredServices: ["RDS"] });

    expect(nextStepOf(model)).toBe("scan");
  });
});
