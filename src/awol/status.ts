import type { ReleaseCycle } from "../endoflife/release-cycles.ts";

export type Status = "AWOL" | "Falling behind" | "Current" | "Untracked";

// Most urgent first.
export const STATUSES: Status[] = ["AWOL", "Falling behind", "Current", "Untracked"];

// How close End of life has to be for a Component to be Falling behind.
const FALLING_BEHIND_DAYS = 180;

// Where a Component on `cycle` stands on `today`, a YYYY-MM-DD date in UTC.
export function statusOf(cycle: ReleaseCycle | undefined, today: string): Status {
  if (cycle === undefined) return "Untracked";
  const { activeSupportEnd, endOfLife } = cycle;
  if (endOfLife !== undefined && today >= endOfLife) return "AWOL";
  if (activeSupportEnd !== undefined && today >= activeSupportEnd) return "Falling behind";
  if (endOfLife !== undefined && addDays(today, FALLING_BEHIND_DAYS) >= endOfLife) return "Falling behind";
  return "Current";
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
