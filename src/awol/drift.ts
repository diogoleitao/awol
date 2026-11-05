import type { ReleaseCycle } from "../endoflife/release-cycles.ts";

// How far one figure of a Component's Drift is: behind `version`, on it or
// past it, or not available because there is no figure to compare with.
export type Drift = { kind: "behind"; version: string } | { kind: "none" } | { kind: "not-available" };

// The Drift of `version` from `target`, by version order.
export function driftFrom(version: string, target: string | undefined): Drift {
  if (target === undefined) return { kind: "not-available" };
  return compareVersions(version, target) < 0 ? { kind: "behind", version: target } : { kind: "none" };
}

// The one of `cycles` with the highest Latest patch. Of all a Product's
// Release Cycles, that is its Newest cycle: for RDS MySQL the 8.4 line, not
// the 8.4.9 minor cycle endoflife.date lists first. Of the cycles a version
// matches, it is the line that gives the Latest patch: for MySQL 8.4.7, the
// 8.4 line's 8.4.11 over the 8.4.7 cycle's own 8.4.7.
export function withHighestLatestPatch(cycles: ReleaseCycle[]): ReleaseCycle | undefined {
  return cycles.reduce<ReleaseCycle | undefined>(
    (newest, cycle) =>
      cycle.latest !== undefined && (newest?.latest === undefined || compareVersions(cycle.latest, newest.latest) > 0) ? cycle : newest,
    undefined,
  );
}

// The Drift of a Component from the Newest cycle: none when the Newest cycle
// is among `cycleNames`, the Release Cycle names its version could match, and
// not available for a Component matched to no Release Cycle.
export function driftFromCycle(
  releaseCycle: ReleaseCycle | undefined,
  cycleNames: string[],
  newestCycle: ReleaseCycle | undefined,
): Drift {
  if (releaseCycle === undefined || newestCycle === undefined) return { kind: "not-available" };
  return cycleNames.includes(newestCycle.name) ? { kind: "none" } : { kind: "behind", version: newestCycle.name };
}

// Orders versions by their dotted numbers, skipping a dotted word such as
// Aurora MySQL's `mysql_aurora`, then with a build suffix after the version
// it builds on: `8.0.46` before `8.0.46-rds.20260624` before
// `8.0.46-rds.20260908` before `8.4.5`, and `8.0.mysql_aurora.3.14.0` before
// `8.4.mysql_aurora.8.4.7`.
export function compareVersions(a: string, b: string): number {
  const [aNumbers = "", aSuffix] = splitSuffix(a);
  const [bNumbers = "", bSuffix] = splitSuffix(b);
  const aParts = dottedNumbers(aNumbers);
  const bParts = dottedNumbers(bNumbers);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const difference = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  if (aSuffix === bSuffix) return 0;
  if (aSuffix === undefined) return -1;
  if (bSuffix === undefined) return 1;
  return aSuffix < bSuffix ? -1 : 1;
}

function dottedNumbers(version: string): number[] {
  return version
    .split(".")
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
}

function splitSuffix(version: string): [string, string | undefined] {
  const dash = version.indexOf("-");
  return dash === -1 ? [version, undefined] : [version.slice(0, dash), version.slice(dash + 1)];
}
