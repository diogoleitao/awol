import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Runs the `aws` CLI with one argv, the `aws` itself left out, giving its
// stdout. A failed call throws an AwsCliError. Tests swap in a runner that
// replays recorded output.
export type AwsRunner = (argv: string[]) => Promise<string>;

// Why an `aws` call failed: credentials that have expired or need an SSO
// login, or anything else.
export type AwsErrorKind = "expired-credentials" | "failed";

export class AwsCliError extends Error {
  constructor(
    readonly argv: string[],
    readonly kind: AwsErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AwsCliError";
  }
}

const KINDS: [AwsErrorKind, RegExp][] = [
  [
    "expired-credentials",
    /\((ExpiredToken|ExpiredTokenException)\)|Error when retrieving token from sso|SSO session associated with this profile has expired|Error loading SSO Token/,
  ],
];

// The error for an `aws` call that failed with `stderr`.
export function awsCliError(argv: string[], stderr: string): AwsCliError {
  const kind = KINDS.find(([, pattern]) => pattern.test(stderr))?.[0] ?? "failed";
  return new AwsCliError(argv, kind, stderr.trim());
}

const run = promisify(execFile);

// The `aws` CLI on the PATH, with the profile and credentials of the shell
// that started awol.
export function awsCli(): AwsRunner {
  return async (argv) => {
    try {
      const { stdout } = await run("aws", argv, { maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      const { stderr } = error as { stderr?: string };
      if (stderr === undefined) throw error;
      throw awsCliError(argv, stderr);
    }
  };
}
