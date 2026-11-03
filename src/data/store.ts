import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Scan } from "../awol/scan.ts";
import { ifExists, writeFileAtomically } from "../fs.ts";

// What awol keeps about one AWS account: when it first and last saw it, and
// its last Scan. Before awol sees an account there is nothing.
export type AccountState = {
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastScan?: Scan;
};

export function defaultDataDir(home: string): string {
  return path.join(home, ".local", "share", "awol");
}

// The last change queued on each state file. Kept on globalThis so every
// store on one file takes turns, across `next dev` reloads of this module too.
const queues = ((globalThis as { awolStateQueues?: Map<string, Promise<unknown>> }).awolStateQueues ??=
  new Map());

// The state of each AWS account, kept apart under `accounts/<account ID>/`.
export function openStore(dataDir: string) {
  return {
    account(accountId: string) {
      // The account ID names a directory, so anything but one is refused.
      if (!/^\d{12}$/.test(accountId)) throw new Error(`not an AWS account ID: ${JSON.stringify(accountId)}`);
      const statePath = path.join(dataDir, "accounts", accountId, "state.json");

      async function load(): Promise<AccountState> {
        const text = await ifExists(readFile(statePath, "utf8"));
        return text === undefined ? {} : (JSON.parse(text) as AccountState);
      }

      return {
        load,

        // Loads the state, changes it, and saves it, after every change
        // queued before it, so two changes never overwrite each other.
        update(change: (state: AccountState) => AccountState): Promise<void> {
          const previous = queues.get(statePath) ?? Promise.resolve();
          const next = previous
            .catch(() => {})
            .then(async () => {
              const state = change(await load());
              await writeFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
            });
          queues.set(statePath, next);
          return next;
        },
      };
    },
  };
}
