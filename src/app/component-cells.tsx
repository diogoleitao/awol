import { History, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ComponentDrift, ComponentRow, Drift, SupportDates } from "../awol/page-model.ts";
import type { Status } from "../awol/status.ts";
import { formatTime } from "./format.ts";

// What the dashboard's table and a Component's page both show of a
// Component.

// A Component's Status, with it marked when Stale or when its sources
// disagree.
export function StatusCell({ component }: { component: ComponentRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge status={component.status} />
      {component.stale !== undefined && (
        <Badge variant="outline" className="border-sky-600 text-sky-700 dark:text-sky-400">
          <History />
          Stale since {formatTime(component.stale.lastReadAt)}
        </Badge>
      )}
      {component.datesDisagree && (
        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
          <TriangleAlert />
          Sources disagree
        </Badge>
      )}
    </div>
  );
}

// A Component's date for `field`, the one that decides Status, with each
// source's own date under it.
export function DateWithSources({ component, field }: { component: ComponentRow; field: keyof SupportDates }) {
  return (
    <>
      {field === "endOfLife" ? <EndOfLife component={component} /> : component[field]}
      <SourceDates component={component} field={field} />
    </>
  );
}

// A Component's End of life, or, for a Current one with none, that none is
// announced.
function EndOfLife({ component }: { component: ComponentRow }) {
  if (component.endOfLife !== undefined) return component.endOfLife;
  if (component.status === "Current") return <span className="text-muted-foreground">End of life not announced</span>;
  return null;
}

// Each source's own date for `field`, under the one that decides Status, for
// the sources that give one.
function SourceDates({ component, field }: { component: ComponentRow; field: keyof SupportDates }) {
  const dates = Object.entries(component.sources).flatMap(([source, dates]) =>
    dates[field] === undefined ? [] : [{ source, date: dates[field] }],
  );
  if (dates.length === 0) return null;
  return (
    <ul className="text-xs text-muted-foreground">
      {dates.map(({ source, date }) => (
        <li key={source}>
          {source === "aws" ? "AWS" : source} {date}
        </li>
      ))}
    </ul>
  );
}

const DRIFT_FIGURES: [keyof ComponentDrift, string][] = [
  ["latestPatch", "Latest patch"],
  ["newestCycle", "Newest cycle"],
  ["newestOffered", "Newest offered"],
];

// Each Drift figure: the version the Component is behind, or that it has no
// Drift there, or that the figure is not available.
export function DriftFigures({ drift }: { drift: ComponentDrift }) {
  return (
    <ul className="text-xs">
      {DRIFT_FIGURES.map(([figure, label]) => (
        <li key={figure}>
          <span className="text-muted-foreground">{label}</span> <DriftValue drift={drift[figure]} />
        </li>
      ))}
    </ul>
  );
}

// One Drift figure: the version behind, or that there is no Drift, or that
// it is not available.
function DriftValue({ drift }: { drift: Drift }) {
  if (drift.kind === "behind") return <span className="font-mono">{drift.version}</span>;
  return <span className="text-muted-foreground">{drift.kind === "none" ? "no Drift" : "not available"}</span>;
}

const STATUS_CLASSES: Record<Status, string> = {
  AWOL: "border-transparent bg-destructive text-white",
  "Falling behind": "border-transparent bg-amber-500 text-black",
  Current: "border-transparent bg-emerald-600 text-white",
  Untracked: "text-muted-foreground",
};

// A Status, as a badge in its Status's color.
function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {status}
    </Badge>
  );
}
