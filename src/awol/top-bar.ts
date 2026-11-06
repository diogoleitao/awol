import type { Running, SignedIn } from "./page-model.ts";

// The last run of a Scan or Discovery, as the top bar tells it: none yet,
// when it ended, when a Discovery that stopped part-way started, or, while
// it runs, who started it and when, once it holds the account's lock.
export type LastRun =
  | { kind: "none-yet" }
  | { kind: "ran"; at: string }
  | { kind: "stopped-part-way"; startedAt: string }
  | { kind: "running"; run?: Running };

// A Scan or Discovery in the top bar: its last run, how many parts of it
// could not be read, whether that or a Discovery stopped part-way marks it,
// and why it cannot run now, if it cannot: a Scan or Discovery of the account
// is running, or, for a Scan, no Monitored services are chosen yet, which it
// tells over the other.
export type TopBarItem = {
  lastRun: LastRun;
  failedParts: number;
  warning: boolean;
  blocked?: "busy" | "no-monitored-services";
};

// The account's Discovery and Scan, as the top bar shows them.
export type TopBar = { discovery: TopBarItem; scan: TopBarItem };

// Whether a Discovery of `model`'s account is running. `discoveryRunningHere`
// is whether this server runs one, which it does before it holds the
// account's lock.
function discovering({ running }: SignedIn, discoveryRunningHere: boolean): boolean {
  return discoveryRunningHere || running?.operation === "Discovery";
}

// Whether any Scan or Discovery of `model`'s account is running, which every
// Scan and Discovery waits for.
export function busyOf(model: SignedIn, discoveryRunningHere: boolean): boolean {
  return discovering(model, discoveryRunningHere) || model.running !== undefined;
}

// The top bar of `model`'s account. `discoveryRunningHere` is whether this
// server runs a Discovery.
export function topBarOf(model: SignedIn, discoveryRunningHere: boolean): TopBar {
  const { discovery, monitoredServices, lastScan, running } = model;
  const busy = busyOf(model, discoveryRunningHere);
  const discoveryRun: LastRun = discovering(model, discoveryRunningHere)
    ? { kind: "running", ...(running?.operation === "Discovery" && { run: running }) }
    : discovery === undefined
      ? { kind: "none-yet" }
      : discovery.finishedAt === undefined
        ? { kind: "stopped-part-way", startedAt: discovery.startedAt }
        : { kind: "ran", at: discovery.finishedAt };
  const scanRun: LastRun =
    running?.operation === "Scan"
      ? { kind: "running", run: running }
      : lastScan === undefined
        ? { kind: "none-yet" }
        : { kind: "ran", at: lastScan.ranAt };
  const discoveryFailed = discovery?.failedParts.length ?? 0;
  const scanFailed = lastScan?.failedParts.length ?? 0;
  const scanBlocked = monitoredServices === undefined ? "no-monitored-services" : busy ? "busy" : undefined;
  return {
    discovery: {
      lastRun: discoveryRun,
      failedParts: discoveryFailed,
      warning: discoveryFailed > 0 || discoveryRun.kind === "stopped-part-way",
      ...(busy && { blocked: "busy" }),
    },
    scan: {
      lastRun: scanRun,
      failedParts: scanFailed,
      warning: scanFailed > 0,
      ...(scanBlocked !== undefined && { blocked: scanBlocked }),
    },
  };
}
