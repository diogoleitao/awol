import type { AwsRunner } from "./runner.ts";

// Whether an `aws` argv only reads (ADR 0002): a `describe-*`, `list-*` or
// `get-*` subcommand of a service, or `sts get-caller-identity`, with the
// service and subcommand first.
export function isReadOnly(argv: string[]): boolean {
  const [service, subcommand] = argv;
  if (service === "sts" && subcommand === "get-caller-identity") return true;
  return (
    service !== undefined &&
    subcommand !== undefined &&
    /^[a-z0-9-]+$/.test(service) &&
    /^(describe|list|get)-[a-z0-9-]+$/.test(subcommand)
  );
}

// Wraps `runner` so an argv that does not only read is refused before
// `runner` sees it.
export function readOnly(runner: AwsRunner): AwsRunner {
  return async (argv) => {
    if (!isReadOnly(argv)) {
      throw new Error(`awol is read-only: refused to run \`aws ${argv.slice(0, 2).join(" ")}\``);
    }
    return runner(argv);
  };
}
