import { readOnly } from "../aws/read-only.ts";
import { AwsCliError, type AwsRunner } from "../aws/runner.ts";
import { openStore } from "../data/store.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import type { PageModel } from "./page-model.ts";

export type Clock = { now(): Date };

export type AwolOptions = {
  aws: AwsRunner;
  // Where Scans read Release Cycles from.
  endOfLife: EndOfLifeFetcher;
  dataDir: string;
  clock: Clock;
};

export function openAwol({ aws: runner, dataDir, clock }: AwolOptions) {
  // Every AWS call awol makes goes through here (ADR 0002).
  const aws = readOnly(runner);
  const store = openStore(dataDir);

  // The ID of the AWS account behind the active profile, recorded as seen
  // now.
  async function identify(): Promise<string> {
    const stdout = await aws(["sts", "get-caller-identity", "--output", "json"]);
    const accountId = (JSON.parse(stdout) as { Account: string }).Account;
    const seenAt = clock.now().toISOString();
    await store.account(accountId).update((state) => ({
      ...state,
      firstSeenAt: state.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
    }));
    return accountId;
  }

  return {
    // Credentials that have expired or need an SSO login make a page that
    // asks to log in again, with the CLI's reason.
    async pageModel(): Promise<PageModel> {
      try {
        return { kind: "signed-in", accountId: await identify() };
      } catch (error) {
        if (error instanceof AwsCliError && error.kind === "expired-credentials") {
          return { kind: "login-needed", reason: error.message };
        }
        throw error;
      }
    },
  };
}
