import { type FSWatcher, mkdirSync, watch } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { cache } from "react";
import { awsCli } from "../aws/runner.ts";
import { openAwol } from "../awol/awol.ts";
import type { DiscoveryScope } from "../awol/discovery.ts";
import { defaultDataDir } from "../data/store.ts";
import { startedWhere } from "../awol/page-model.ts";
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

// What the top bar and the page show, read once per request however many of
// them ask for it.
export const pageModel = cache(() => appAwol().pageModel());

// A change the open tabs should show: when it was sent to them.
export type LiveUpdate = { sentAt: string };

type Listener = (update: LiveUpdate) => void;

const running = globalThis as { awolListeners?: Set<Listener>; awolDiscovery?: Promise<void>; awolRunWatcher?: FSWatcher };

// Kept on globalThis so the Discovery and every open tab's stream share one
// set, across `next dev` reloads of this module too.
const listeners = (running.awolListeners ??= new Set());

// Tells `listener` about every change from now on, until the returned
// function is called. Nothing is queued: a change made before it was added
// is never told.
export function listenToUpdates(listener: Listener): () => void {
  watchRuns();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Tells the open tabs each time a Scan or Discovery of any account starts or
// ends, whether this server or `awol scan` or `awol discover` runs it, by
// watching for the lock each holds. It watches nothing else: the account's
// state changes on every page load, which would refresh the tabs forever.
// Started on the first tab's stream, once, and again if it stops.
function watchRuns() {
  if (running.awolRunWatcher !== undefined) return;
  const accounts = path.join(defaultDataDir(homedir()), "accounts");
  mkdirSync(accounts, { recursive: true });
  running.awolRunWatcher = watch(accounts, { recursive: true }, (_, file) => {
    if (file !== null && path.basename(file) === "running.json") tellListeners();
  }).on("error", (error) => {
    console.error("awol: stopped watching for Scans and Discoveries:", error);
    running.awolRunWatcher?.close();
    running.awolRunWatcher = undefined;
  });
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
// follow just like one `startDiscovery` starts, or else a Scan. Neither runs
// while `awol scan` or `awol discover` is running one, and `--force` on
// either cancels it, each of which the log tells. It is not awaited.
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
    .then((outcome) => {
      if (outcome.kind === "busy") {
        console.log(`awol: nothing ran on start: a ${outcome.running.operation} ${startedWhere(outcome.running)} is running`);
      }
      if (outcome.kind === "cancelled") console.log("awol: the Scan or Discovery on start was cancelled by --force");
    })
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
