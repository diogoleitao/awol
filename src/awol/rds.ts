import type { AwsRunner } from "../aws/runner.ts";
import type { ComponentReading, ExtendedSupport, Product, SupportDates } from "./component.ts";
import { highestVersion } from "./drift.ts";

// A Product awol reads from RDS, with the AWS major version a version is in,
// and whether AWS offers it Extended Support at all.
type RdsProduct = Product & {
  awsMajorVersion(version: string): string;
  hasExtendedSupport: boolean;
};

// The Extended Support setting by EngineLifecycleSupport.
const EXTENDED_SUPPORT: Record<string, ExtendedSupport> = {
  "open-source-rds-extended-support": "Extended Support",
  "open-source-rds-extended-support-disabled": "auto-upgrade at End of life",
};

// The RDS Products by Engine. Any other Engine, such as Oracle or SQL Server,
// is not a Component.
const PRODUCTS: Record<string, RdsProduct> = {
  // By major (`13.7` to `13`), except before 10, where the cycle is `x.y`
  // (`9.6.24` to `9.6`). The AWS major version is the same.
  postgres: {
    name: "RDS PostgreSQL",
    endOfLifeProduct: "amazon-rds-postgresql",
    cycleNames: (version) => [postgresMajor(version)],
    awsMajorVersion: postgresMajor,
    hasExtendedSupport: true,
    latestPatchVersion: (version) => version,
  },
  // By exact minor cycle first (`8.0.46-rds.20260624` to `8.0.46`), then
  // `x.y` (`8.0.35` to `8.0`). The AWS major version is `x.y`.
  mysql: {
    name: "RDS MySQL",
    endOfLifeProduct: "amazon-rds-mysql",
    cycleNames: (version) => {
      const minor = version.split("-")[0]!;
      return [minor, majorMinor(minor)];
    },
    awsMajorVersion: majorMinor,
    hasExtendedSupport: true,
    latestPatchVersion: (version) => version,
  },
  // By `x.y` (`10.11.15` to `10.11`), as is the AWS major version. AWS gives
  // MariaDB standard support only, so an instance's Extended Support setting
  // means nothing.
  mariadb: {
    name: "RDS MariaDB",
    endOfLifeProduct: "amazon-rds-mariadb",
    cycleNames: (version) => [majorMinor(version)],
    awsMajorVersion: majorMinor,
    hasExtendedSupport: false,
    latestPatchVersion: (version) => version,
  },
  // By major (`15.4` to `15`), as is the AWS major version.
  "aurora-postgresql": {
    name: "Aurora PostgreSQL",
    endOfLifeProduct: "amazon-aurora-postgresql",
    cycleNames: (version) => [postgresMajor(version)],
    awsMajorVersion: postgresMajor,
    hasExtendedSupport: true,
    latestPatchVersion: (version) => version,
  },
  // By the first number of the Aurora version inside the engine version
  // (`8.0.mysql_aurora.3.04.0` to `3`), except from 8.4, where the Aurora
  // version is the MySQL version and the cycle is `x.y`
  // (`8.4.mysql_aurora.8.4.7` to `8.4`). The AWS major version is the MySQL
  // `x.y` in front, and Latest patches are Aurora versions.
  "aurora-mysql": {
    name: "Aurora MySQL",
    endOfLifeProduct: "amazon-aurora-mysql",
    cycleNames: (version) => {
      const [mysql, aurora] = splitAuroraMysql(version);
      return [aurora.startsWith(`${mysql}.`) ? mysql : aurora.split(".")[0]!];
    },
    awsMajorVersion: majorMinor,
    hasExtendedSupport: true,
    latestPatchVersion: (version) => splitAuroraMysql(version)[1],
  },
};

function postgresMajor(version: string): string {
  const [major, minor] = version.split(".");
  return Number(major) < 10 ? `${major}.${minor}` : major!;
}

// The MySQL `x.y` and the Aurora version of an Aurora MySQL engine version:
// `8.0.mysql_aurora.3.04.0` to `8.0` and `3.04.0`.
function splitAuroraMysql(version: string): [string, string] {
  const [mysql = "", aurora = ""] = version.split(".mysql_aurora.");
  return [mysql, aurora];
}

function majorMinor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

// What an RDS instance or DB cluster reports.
type DbComponent = {
  identifier: string;
  Engine: string;
  EngineVersion: string;
  EngineLifecycleSupport?: string;
};

type DbInstance = Omit<DbComponent, "identifier"> & { DBInstanceIdentifier: string; DBClusterIdentifier?: string };

type DbCluster = Omit<DbComponent, "identifier"> & { DBClusterIdentifier: string };

// The RDS instances and DB clusters in `region` that are Components, each
// with AWS's support dates for its AWS major version there and the Newest
// offered version of its Product there. An instance in a DB cluster is not a
// Component: its cluster is.
export async function readRdsComponents(aws: AwsRunner, region: string): Promise<ComponentReading[]> {
  // One call at a time, so a region makes one call at once.
  const instancesStdout = await aws(["rds", "describe-db-instances", "--region", region, "--output", "json"]);
  const clustersStdout = await aws(["rds", "describe-db-clusters", "--region", region, "--output", "json"]);
  const components: DbComponent[] = [
    ...(JSON.parse(instancesStdout) as { DBInstances: DbInstance[] }).DBInstances.filter(
      (instance) => instance.DBClusterIdentifier === undefined,
    ).map((instance) => ({ ...instance, identifier: instance.DBInstanceIdentifier })),
    ...(JSON.parse(clustersStdout) as { DBClusters: DbCluster[] }).DBClusters.map((cluster) => ({
      ...cluster,
      identifier: cluster.DBClusterIdentifier,
    })),
  ].filter((component) => PRODUCTS[component.Engine] !== undefined);

  const lifecyclesByEngine = new Map<string, Map<string, SupportDates>>();
  const newestOfferedByEngine = new Map<string, string | undefined>();
  for (const engine of new Set(components.map((component) => component.Engine))) {
    lifecyclesByEngine.set(engine, await readAwsLifecycles(aws, region, engine));
    newestOfferedByEngine.set(engine, await readNewestOffered(aws, region, engine));
  }

  return components.map((component) => {
    const product = PRODUCTS[component.Engine]!;
    return {
      service: "RDS",
      product,
      region,
      identifier: component.identifier,
      version: component.EngineVersion,
      extendedSupport: product.hasExtendedSupport ? EXTENDED_SUPPORT[component.EngineLifecycleSupport ?? ""] : undefined,
      awsLifecycle: lifecyclesByEngine.get(component.Engine)!.get(product.awsMajorVersion(component.EngineVersion)) ?? {},
      newestOffered: newestOfferedByEngine.get(component.Engine),
    };
  });
}

// The highest version of `engine` AWS offers in `region`. Without
// `--include-all`, AWS lists only available versions.
async function readNewestOffered(aws: AwsRunner, region: string, engine: string): Promise<string | undefined> {
  const stdout = await aws(["rds", "describe-db-engine-versions", "--region", region, "--engine", engine, "--output", "json"]);
  const versions = (JSON.parse(stdout) as { DBEngineVersions: { EngineVersion: string }[] }).DBEngineVersions;
  return highestVersion(versions.map(({ EngineVersion }) => EngineVersion));
}

type DbMajorEngineVersion = {
  MajorEngineVersion: string;
  SupportedEngineLifecycles: { LifecycleSupportName: string; LifecycleSupportEndDate: string }[];
};

// AWS's support dates for each AWS major version of `engine` in `region`. The
// end of standard support is End of life; MariaDB has no Extended Support.
async function readAwsLifecycles(aws: AwsRunner, region: string, engine: string): Promise<Map<string, SupportDates>> {
  const stdout = await aws([
    "rds",
    "describe-db-major-engine-versions",
    "--region",
    region,
    "--engine",
    engine,
    "--output",
    "json",
  ]);
  const majorVersions = (JSON.parse(stdout) as { DBMajorEngineVersions: DbMajorEngineVersion[] }).DBMajorEngineVersions;
  return new Map(
    majorVersions.map(({ MajorEngineVersion, SupportedEngineLifecycles }) => {
      const endOf = (name: string) => {
        const end = SupportedEngineLifecycles.find((lifecycle) => lifecycle.LifecycleSupportName === name)?.LifecycleSupportEndDate;
        return end === undefined ? undefined : utcDate(end);
      };
      return [
        MajorEngineVersion,
        {
          endOfLife: endOf("open-source-rds-standard-support"),
          extendedSupportEnd: endOf("open-source-rds-extended-support"),
        },
      ];
    }),
  );
}

// The UTC date of a timestamp AWS gives. AWS ends support on the last moment
// of that date, the day endoflife.date gives as the end.
function utcDate(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
