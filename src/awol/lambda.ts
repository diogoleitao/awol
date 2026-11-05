import type { AwsRunner } from "../aws/runner.ts";
import type { ReleaseCycle } from "../endoflife/release-cycles.ts";
import type { ComponentReading, Product } from "./component.ts";
import { compareVersions } from "./drift.ts";

// AWS Lambda, by runtime: the runtime is the Release Cycle (`python3.12`).
// endoflife.date's end of Active support for a runtime is its deprecation
// date, which is End of life; its End of life is the date AWS blocks updates
// to functions on it, which awol leaves out. The Newest cycle is the newest
// runtime of the same language.
export const LAMBDA_PRODUCT: Product = {
  name: "AWS Lambda",
  endOfLifeProduct: "aws-lambda",
  cycleNames: (runtime) => [runtime],
  latestPatchVersion: (runtime) => runtime,
  readReleaseCycle: ({ name, releaseDate, activeSupportEnd }) => ({ name, releaseDate, endOfLife: activeSupportEnd }),
  newestCycle: (cycles, { name }) =>
    newestRuntime(cycles.filter((cycle) => splitRuntime(cycle.name).language === splitRuntime(name).language)),
};

// The language of a runtime and the version of it the runtime runs: the
// letters it starts with and the number after them (`python3.12` to `python`
// and `3.12`, `nodejs20.x` to `nodejs` and `20`, `java17.al2023` to `java`
// and `17`), with no version for `provided.al2023`. The old `dotnetcore`
// runtimes count as `dotnet`.
function splitRuntime(runtime: string): { language: string; version: string } {
  const [, letters = "", version = ""] = /^([a-z]*)(\d+(?:\.\d+)*)?/.exec(runtime)!;
  return { language: letters === "dotnetcore" ? "dotnet" : letters, version };
}

// The newest of the Release Cycles of one language's runtimes: on the
// highest version of the language, and of those, the one released last
// (`java17.al2023` over `java17`).
function newestRuntime(cycles: ReleaseCycle[]): ReleaseCycle | undefined {
  return cycles.reduce<ReleaseCycle | undefined>((newest, cycle) => {
    if (newest === undefined) return cycle;
    const difference = compareVersions(splitRuntime(cycle.name).version, splitRuntime(newest.name).version);
    return difference > 0 || (difference === 0 && (cycle.releaseDate ?? "") > (newest.releaseDate ?? "")) ? cycle : newest;
  }, undefined);
}

type FunctionConfiguration = { FunctionName: string; Runtime?: string; PackageType: string; Version: string };

// An alias points to `FunctionVersion`, and, when weighted, to the version
// in `AdditionalVersionWeights` too.
type Alias = { FunctionVersion: string; RoutingConfig?: { AdditionalVersionWeights?: Record<string, number> } };

// The Lambda functions in `region`: each function's $LATEST, and each
// published version an alias points to, each once and on its own runtime. A
// function deployed as a container image has no runtime.
export async function readLambdaComponents(aws: AwsRunner, region: string): Promise<ComponentReading[]> {
  // One call at a time, so a region makes one call at once.
  const stdout = await aws(["lambda", "list-functions", "--region", region, "--output", "json"]);
  const configurations: FunctionConfiguration[] = [];
  for (const latest of (JSON.parse(stdout) as { Functions: FunctionConfiguration[] }).Functions) {
    configurations.push(latest);
    const aliasesStdout = await aws([
      "lambda",
      "list-aliases",
      "--region",
      region,
      "--function-name",
      latest.FunctionName,
      "--output",
      "json",
    ]);
    const aliases = (JSON.parse(aliasesStdout) as { Aliases: Alias[] }).Aliases;
    const versions = new Set(
      aliases.flatMap(({ FunctionVersion, RoutingConfig }) => [FunctionVersion, ...Object.keys(RoutingConfig?.AdditionalVersionWeights ?? {})]),
    );
    versions.delete(latest.Version);
    for (const version of versions) {
      const versionStdout = await aws([
        "lambda",
        "get-function-configuration",
        "--region",
        region,
        "--function-name",
        latest.FunctionName,
        "--qualifier",
        version,
        "--output",
        "json",
      ]);
      configurations.push(JSON.parse(versionStdout) as FunctionConfiguration);
    }
  }
  return configurations.map((configuration) => ({
    service: "Lambda",
    product: LAMBDA_PRODUCT,
    region,
    identifier: `${configuration.FunctionName}:${configuration.Version}`,
    version: configuration.PackageType === "Image" ? undefined : configuration.Runtime,
    awsLifecycle: {},
  }));
}
