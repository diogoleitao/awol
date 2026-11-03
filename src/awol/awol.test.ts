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

// No test here reads lifecycles.
const endOfLife: EndOfLifeFetcher = async (url) => {
  throw new Error(`unexpected endoflife.date fetch of ${url}`);
};

function awol(aws: AwsRunner, now = NOW) {
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
