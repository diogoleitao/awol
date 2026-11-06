export { startedWhere } from "../awol/page-model.ts";

// A moment today, as the dashboard shows it: its time, to the minute.
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// A moment, as the dashboard shows it: its date and time, to the minute.
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
