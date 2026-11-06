import { homedir } from "node:os";
import { awsCli } from "../aws/runner.ts";
import { openAwol } from "../awol/awol.ts";
import type { DiscoveryScope } from "../awol/discovery.ts";
import { defaultDataDir } from "../data/store.ts";
import { endOfLifeFetcher } from "../endoflife/fetcher.ts";

// The app's entry into awol: the `aws` CLI with the shell's active profile,
// endoflife.date, the state under ~/.local/share/awol/, and the real clock.
export function appAwol() {
  return openAwol({
    aws: awsCli(),
    endOfLife: endOfLifeFetcher(),
    dataDir: defaultDataDir(homedir()),
    clock: { now: () => new Date() },
  });
}

// A change the open tabs should show: when it was sent to them.
export type LiveUpdate = { sentAt: string };

type Listener = (update: LiveUpdate) => void;

const running = globalThis as { awolListeners?: Set<Listener>; awolDiscovery?: Promise<void> };

// Kept on globalThis so the Discovery and every open tab's stream share one
// set, across `next dev` reloads of this module too.
const listeners = (running.awolListeners ??= new Set());

// Tells `listener` about every change from now on, until the returned
// function is called. Nothing is queued: a change made before it was added
// is never told.
export function listenToUpdates(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function tellListeners() {
  const update = { sentAt: new Date().toISOString() };
  for (const listener of listeners) listener(update);
}

// Starts a Discovery of `scope`, unless one is running, telling the open
// tabs of each part it keeps and of its end. It is not awaited: the tabs
// follow it through their streams.
export function startDiscovery(scope: DiscoveryScope): void {
  if (running.awolDiscovery !== undefined) return;
  running.awolDiscovery = appAwol()
    .discover({ scope, onPart: tellListeners })
    .then(() => {})
    .catch((error: unknown) => console.error("awol: the Discovery failed:", error))
    .finally(() => {
      running.awolDiscovery = undefined;
      tellListeners();
    });
}

// Does what awol does when the server starts, unless a Discovery is running:
// a Discovery of an account it has never discovered, which the open tabs
// follow just like one `startDiscovery` starts, or else a Scan. It is not
// awaited.
export function startUp(): void {
  if (running.awolDiscovery !== undefined) return;
  const startingUp: Promise<void> = appAwol()
    .start({
      onDiscovery: () => {
        running.awolDiscovery = startingUp;
        tellListeners();
      },
      onPart: tellListeners,
    })
    .then(() => {})
    .catch((error: unknown) => console.error("awol: the Scan or Discovery on start failed:", error))
    .finally(() => {
      if (running.awolDiscovery !== startingUp) return;
      running.awolDiscovery = undefined;
      tellListeners();
    });
}

// Whether a Discovery is running in this server.
export function discoveryRunning(): boolean {
  return running.awolDiscovery !== undefined;
}
