import type { AwsRunner } from "../aws/runner.ts";

// A Product awol reads from RDS: its name, its endoflife.date product, and
// the Release Cycle names a version could match, most specific first.
export type Product = {
  name: string;
  endOfLifeProduct: string;
  cycleNames(version: string): string[];
};

// One Component as a Scan read it from AWS.
export type ComponentReading = {
  service: "RDS";
  product: Product;
  region: string;
  identifier: string;
  version: string;
};

// The RDS Products by Engine. Any other Engine, such as Oracle or SQL Server,
// is not a Component.
const PRODUCTS: Record<string, Product> = {
  // By major (`13.7` to `13`), except before 10, where the cycle is `x.y`
  // (`9.6.24` to `9.6`).
  postgres: {
    name: "RDS PostgreSQL",
    endOfLifeProduct: "amazon-rds-postgresql",
    cycleNames: (version) => {
      const [major, minor] = version.split(".");
      return [Number(major) < 10 ? `${major}.${minor}` : major!];
    },
  },
  // By exact minor cycle first (`8.0.46-rds.20260624` to `8.0.46`), then
  // `x.y` (`8.0.35` to `8.0`).
  mysql: {
    name: "RDS MySQL",
    endOfLifeProduct: "amazon-rds-mysql",
    cycleNames: (version) => {
      const minor = version.split("-")[0]!;
      return [minor, majorMinor(minor)];
    },
  },
  // By `x.y` (`10.11.15` to `10.11`).
  mariadb: {
    name: "RDS MariaDB",
    endOfLifeProduct: "amazon-rds-mariadb",
    cycleNames: (version) => [majorMinor(version)],
  },
};

function majorMinor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

type DbInstance = {
  DBInstanceIdentifier: string;
  Engine: string;
  EngineVersion: string;
  DBClusterIdentifier?: string;
};

// The RDS instances in `region` that are Components. An instance in a DB
// cluster is not: its cluster is.
export async function readRdsInstances(aws: AwsRunner, region: string): Promise<ComponentReading[]> {
  const stdout = await aws(["rds", "describe-db-instances", "--region", region, "--output", "json"]);
  const instances = (JSON.parse(stdout) as { DBInstances: DbInstance[] }).DBInstances;
  return instances.flatMap((instance) => {
    const product = PRODUCTS[instance.Engine];
    if (product === undefined || instance.DBClusterIdentifier !== undefined) return [];
    return [
      {
        service: "RDS",
        product,
        region,
        identifier: instance.DBInstanceIdentifier,
        version: instance.EngineVersion,
      },
    ];
  });
}
