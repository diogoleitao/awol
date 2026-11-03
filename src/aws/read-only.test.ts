import { describe, expect, it } from "vitest";
import type { AwsRunner } from "./runner.ts";
import { readOnly } from "./read-only.ts";

// A runner that records every argv it is given and answers with an empty
// JSON object.
function recordingRunner(): AwsRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return Object.assign(
    async (argv: string[]) => {
      calls.push(argv);
      return "{}";
    },
    { calls },
  );
}

describe("the read-only guard", () => {
  it("refuses a subcommand that changes AWS before the runner is called", async () => {
    const runner = recordingRunner();
    const aws = readOnly(runner);

    await expect(
      aws(["rds", "modify-db-instance", "--db-instance-identifier", "db-1", "--output", "json"]),
    ).rejects.toThrow("awol is read-only: refused to run `aws rds modify-db-instance`");
    expect(runner.calls).toEqual([]);
  });

  it.each([
    [["sts", "get-caller-identity", "--output", "json"]],
    [["rds", "describe-db-instances", "--region", "eu-west-1", "--output", "json"]],
    [["account", "list-regions", "--output", "json"]],
    [["lambda", "get-function-configuration", "--function-name", "fn-1", "--region", "eu-west-1", "--output", "json"]],
  ])("passes %j to the runner", async (argv) => {
    const runner = recordingRunner();

    await expect(readOnly(runner)(argv)).resolves.toBe("{}");
    expect(runner.calls).toEqual([argv]);
  });

  it.each([
    [["rds", "delete-db-instance", "--db-instance-identifier", "db-1"]],
    [["lambda", "update-function-configuration", "--function-name", "fn-1"]],
    // A global option before the service hides which subcommand runs.
    [["--region", "eu-west-1", "rds", "describe-db-instances"]],
    [["rds", "DESCRIBE-DB-INSTANCES"]],
    [["configure", "set", "region", "eu-west-1"]],
    [["sts"]],
    [[]],
  ])("refuses %j", async (argv) => {
    const runner = recordingRunner();

    await expect(readOnly(runner)(argv)).rejects.toThrow("awol is read-only");
    expect(runner.calls).toEqual([]);
  });
});
