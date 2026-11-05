// A moment, as the dashboard shows it: its date and time, to the minute.
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
