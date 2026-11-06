import type { AwsRunner } from "../aws/runner.ts";
import type { ComponentReading, ComponentVersion, Product } from "./component.ts";
import { highestVersion } from "./drift.ts";

// The OpenSearch Products by the engine in front of a version.
const PRODUCTS: Record<string, Product> = {
  OpenSearch: engineProduct("OpenSearch", "amazon-opensearch"),
  Elasticsearch: engineProduct("Elasticsearch", "amazon-elasticsearch"),
};

// Every OpenSearch Product.
export const OPENSEARCH_PRODUCTS: Product[] = Object.values(PRODUCTS);

// A Product matched by the `x.y` after its engine (`OpenSearch_2.11` to
// `2.11`).
function engineProduct(name: string, endOfLifeProduct: string): Product {
  return {
    name,
    endOfLifeProduct,
    cycleNames: (version) => [splitEngineVersion(version).number],
    latestPatchVersion: (version) => splitEngineVersion(version).number,
  };
}

// The engine and the version of an OpenSearch engine version:
// `Elasticsearch_7.10` to `Elasticsearch` and `7.10`.
function splitEngineVersion(version: string): { engine: string; number: string } {
  const [engine = "", number = ""] = version.split("_");
  return { engine, number };
}

// The most domain names `describe-domains` takes in one call.
const DESCRIBE_DOMAINS_LIMIT = 5;

type DomainStatus = { DomainName: string; EngineVersion: string };

// The OpenSearch Service domains in `region` whose engine is a Product. A
// domain deleted between listing and describing it is not in AWS's answer,
// so is left out.
async function listDomains(aws: AwsRunner, region: string): Promise<DomainStatus[]> {
  // One call at a time, so a region makes one call at once.
  const namesStdout = await aws(["opensearch", "list-domain-names", "--region", region, "--output", "json"]);
  const names = (JSON.parse(namesStdout) as { DomainNames: { DomainName: string }[] }).DomainNames.map(({ DomainName }) => DomainName);
  const domains: DomainStatus[] = [];
  for (let i = 0; i < names.length; i += DESCRIBE_DOMAINS_LIMIT) {
    const batch = names.slice(i, i + DESCRIBE_DOMAINS_LIMIT);
    const stdout = await aws(["opensearch", "describe-domains", "--region", region, "--domain-names", ...batch, "--output", "json"]);
    domains.push(...(JSON.parse(stdout) as { DomainStatusList: DomainStatus[] }).DomainStatusList);
  }
  return domains.filter((domain) => PRODUCTS[splitEngineVersion(domain.EngineVersion).engine] !== undefined);
}

// The OpenSearch Service domains in `region`, whichever engine they run,
// each with its version only.
export async function readOpenSearchVersions(aws: AwsRunner, region: string): Promise<ComponentVersion[]> {
  return (await listDomains(aws, region)).map((domain) => ({
    service: "OpenSearch",
    product: PRODUCTS[splitEngineVersion(domain.EngineVersion).engine]!,
    region,
    identifier: domain.DomainName,
    version: domain.EngineVersion,
  }));
}

// The OpenSearch Service domains in `region`, whichever engine they run,
// each with the Newest offered version of its engine there.
export async function readOpenSearchComponents(aws: AwsRunner, region: string): Promise<ComponentReading[]> {
  const components = await listDomains(aws, region);
  if (components.length === 0) return [];

  const offered = await readOfferedVersions(aws, region);
  return components.map((domain) => {
    const { engine } = splitEngineVersion(domain.EngineVersion);
    return {
      service: "OpenSearch",
      product: PRODUCTS[engine]!,
      region,
      identifier: domain.DomainName,
      version: domain.EngineVersion,
      awsLifecycle: {},
      newestOffered: highestVersion(offered.filter((version) => splitEngineVersion(version).engine === engine)),
    };
  });
}

// The versions of every engine AWS offers in `region`.
async function readOfferedVersions(aws: AwsRunner, region: string): Promise<string[]> {
  const stdout = await aws(["opensearch", "list-versions", "--region", region, "--output", "json"]);
  return (JSON.parse(stdout) as { Versions: string[] }).Versions;
}
