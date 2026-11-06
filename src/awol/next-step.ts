import type { SignedIn } from "./page-model.ts";

// What the dashboard of an account with no Scan yet points to next: a
// Discovery, choosing Monitored services from it, or the Scan itself.
export type NextStep = "discover" | "choose-monitored-services" | "scan";

// The next step of `model`'s account towards its first Scan.
export function nextStepOf({ discovery, monitoredServices }: SignedIn): NextStep {
  if (monitoredServices !== undefined) return "scan";
  return discovery === undefined ? "discover" : "choose-monitored-services";
}
