import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isReadOnly } from "../aws/read-only.ts";
import { type AwsRunner, awsCliError } from "../aws/runner.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import { openAwol } from "./awol.ts";
// Recorded from `aws sts get-caller-identity --output json` against a real
// account, then stripped of the account ID, user ID and user name.
import callerIdentity from "./fixtures/sts-get-caller-identity.json" with { type: "json" };
// Written by hand from the `aws` CLI's messages, since recording them needs an
// expired or missing session: an SSO token that could not be refreshed, an
// SSO session that has expired, an SSO session never logged in to, and
// expired temporary credentials.
import credentialErrors from "./fixtures/credential-errors.json" with { type: "json" };
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

type AccountContents = {
  regions?: { RegionName: string; RegionOptStatus: string }[];
  instances?: Record<string, DbInstance[]>;
  clusters?: Record<string, DbCluster[]>;
  majorVersions?: Record<string, unknown>;
  engineVersions?: Record<string, unknown>;
};

// The recorded account, signed in: its regions, its RDS instances and DB
// clusters by region, where every enabled region not given has none, and
// AWS's RDS lifecycles and offered versions by Engine in each region, the
// recorded ones unless given. A region with no answer fails the Scan.
function account(contents: AccountContents = {}) {
  return fakeAws(accountAnswers(contents));
}

function accountAnswers({
  regions = listRegions.Regions,
  instances = { "eu-west-1": describeDbInstances.DBInstances },
  clusters = {},
  majorVersions = MAJOR_VERSIONS,
  engineVersions = ENGINE_VERSIONS,
}: AccountContents = {}): Record<string, Answer> {
  const answers: Record<string, Answer> = {
    [CALLER_IDENTITY]: SIGNED_IN,
    [LIST_REGIONS]: { stdout: JSON.stringify({ Regions: regions }) },
  };
  for (const region of [...ENABLED_REGIONS, ...Object.keys(instances), ...Object.keys(clusters)]) {
    answers[describeDbInstancesIn(region)] = { stdout: JSON.stringify({ DBInstances: instances[region] ?? [] }) };
    answers[describeDbClustersIn(region)] = { stdout: JSON.stringify({ DBClusters: clusters[region] ?? [] }) };
    for (const [engine, answer] of Object.entries(majorVersions)) {
      answers[describeMajorVersionsIn(region, engine)] = { stdout: JSON.stringify(answer) };
    }
    for (const [engine, answer] of Object.entries(engineVersions)) {
      answers[describeEngineVersionsIn(region, engine)] = { stdout: JSON.stringify(answer) };
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
  await awol(aws, now, endOfLife).scan();
  const model = await awol(aws, now, endOfLife).pageModel();
  if (model.kind !== "signed-in") throw new Error(`not signed in: ${model.reason}`);
  return { component: model.lastScan!.components[0]!, aws };
}

describe("a Scan", () => {
  it("shows every RDS instance of the account with its Status, most urgent first", async () => {
    const aws = account();

    await awol(aws).scan();

    expect(await awol(aws).pageModel()).toEqual({
      kind: "signed-in",
      accountId: "123456789012",
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

    await awol(aws).scan();

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

    await awol(aws).scan();

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

    await awol(aws).scan();

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

    await awol(aws).scan();

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

    await awol(aws).scan();

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

    await awol(aws).scan();

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

    await awol(aws, now).scan();

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

    await awol(aws, farFuture, endOfLife).scan();

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

    await awol(aws).scan();

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

    await awol(first, NOW, endOfLife).scan();
    const firstCalls = endOfLife.calls.splice(0);
    await awol(second, NOW, endOfLife).scan();

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
    await awol(signedIn).scan();

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

    await awol(aws).scan();

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

    await awol(aws).scan();

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
    await awol(aws).scan();
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

    await awol(aws).scan();

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

    await awol(aws).scan();

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
