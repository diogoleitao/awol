import type { AwsRunner } from "../aws/runner.ts";
import { compareVersions } from "./drift.ts";

// A Product awol reads from RDS: its name, its endoflife.date product, the
// Release Cycle names a version could match, most specific first, the AWS
// major version a version is in, and whether AWS offers it Extended Support
// at all.
export type Product = {
  name: string;
  endOfLifeProduct: string;
  cycleNames(version: string): string[];
  awsMajorVersion(version: string): string;
  hasExtendedSupport: boolean;
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

// One Component as a Scan read it from AWS, with AWS's support dates for its
// AWS major version in its region and the Newest offered version of its
// Product there, if AWS offers any.
export type ComponentReading = {
  service: "RDS";
  product: Product;
  region: string;
  identifier: string;
  version: string;
  extendedSupport?: ExtendedSupport;
  awsLifecycle: SupportDates;
  newestOffered?: string;
};

// The Extended Support setting by EngineLifecycleSupport.
const EXTENDED_SUPPORT: Record<string, ExtendedSupport> = {
  "open-source-rds-extended-support": "Extended Support",
  "open-source-rds-extended-support-disabled": "auto-upgrade at End of life",
};

// The RDS Products by Engine. Any other Engine, such as Oracle or SQL Server,
// is not a Component.
const PRODUCTS: Record<string, Product> = {
  // By major (`13.7` to `13`), except before 10, where the cycle is `x.y`
  // (`9.6.24` to `9.6`). The AWS major version is the same.
  postgres: {
    name: "RDS PostgreSQL",
    endOfLifeProduct: "amazon-rds-postgresql",
    cycleNames: (version) => [postgresMajor(version)],
    awsMajorVersion: postgresMajor,
    hasExtendedSupport: true,
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
  },
};

function postgresMajor(version: string): string {
  const [major, minor] = version.split(".");
  return Number(major) < 10 ? `${major}.${minor}` : major!;
}

function majorMinor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

type DbInstance = {
  DBInstanceIdentifier: string;
  Engine: string;
  EngineVersion: string;
  EngineLifecycleSupport?: string;
  DBClusterIdentifier?: string;
};

// The RDS instances in `region` that are Components, each with AWS's support
// dates for its AWS major version there and the Newest offered version of its
// Product there. An instance in a DB cluster is not a Component: its cluster
// is.
export async function readRdsInstances(aws: AwsRunner, region: string): Promise<ComponentReading[]> {
  const stdout = await aws(["rds", "describe-db-instances", "--region", region, "--output", "json"]);
  const instances = (JSON.parse(stdout) as { DBInstances: DbInstance[] }).DBInstances.filter(
    (instance) => PRODUCTS[instance.Engine] !== undefined && instance.DBClusterIdentifier === undefined,
  );

  // One call at a time, so a region makes one call at once.
  const lifecyclesByEngine = new Map<string, Map<string, SupportDates>>();
  const newestOfferedByEngine = new Map<string, string | undefined>();
  for (const engine of new Set(instances.map((instance) => instance.Engine))) {
    lifecyclesByEngine.set(engine, await readAwsLifecycles(aws, region, engine));
    newestOfferedByEngine.set(engine, await readNewestOffered(aws, region, engine));
  }

  return instances.map((instance) => {
    const product = PRODUCTS[instance.Engine]!;
    return {
      service: "RDS",
      product,
      region,
      identifier: instance.DBInstanceIdentifier,
      version: instance.EngineVersion,
      extendedSupport: product.hasExtendedSupport ? EXTENDED_SUPPORT[instance.EngineLifecycleSupport ?? ""] : undefined,
      awsLifecycle: lifecyclesByEngine.get(instance.Engine)!.get(product.awsMajorVersion(instance.EngineVersion)) ?? {},
      newestOffered: newestOfferedByEngine.get(instance.Engine),
    };
  });
}

// The highest version of `engine` AWS offers in `region`. Without
// `--include-all`, AWS lists only available versions.
async function readNewestOffered(aws: AwsRunner, region: string, engine: string): Promise<string | undefined> {
  const stdout = await aws(["rds", "describe-db-engine-versions", "--region", region, "--engine", engine, "--output", "json"]);
  const versions = (JSON.parse(stdout) as { DBEngineVersions: { EngineVersion: string }[] }).DBEngineVersions;
  return versions
    .map(({ EngineVersion }) => EngineVersion)
    .reduce<string | undefined>((newest, version) => (newest === undefined || compareVersions(version, newest) > 0 ? version : newest), undefined);
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
