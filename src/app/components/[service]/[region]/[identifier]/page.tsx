import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type ComponentPathParams, componentAt } from "../../../../../awol/component-page.ts";
import { searchParamsOf, tableStateOf, withQuery } from "../../../../../awol/dashboard-view.ts";
import type { ComponentRow } from "../../../../../awol/page-model.ts";
import { pageModel } from "../../../../app-awol.ts";
import { DateWithSources, DriftFigures, StatusCell } from "../../../../component-cells.tsx";
import { LoginNeeded } from "../../../../login-needed.tsx";

// One Component of the last Scan, with everything the dashboard's table
// shows of it and what it leaves out, or that the last Scan does not have
// it. Its query string is the dashboard's, as the table that linked here
// kept it, so that its link back shows the table as it was.
export default async function ComponentPage({
  params,
  searchParams,
}: {
  params: Promise<ComponentPathParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const model = await pageModel();
  const dashboardHref = withQuery("/", searchParamsOf(tableStateOf(searchParamsFrom(await searchParams))).toString());

  if (model.kind === "login-needed") return <LoginNeeded reason={model.reason} />;

  const component = model.lastScan === undefined ? undefined : componentAt(model.lastScan, await params);
  return (
    <div className="flex flex-col gap-6">
      <Link href={dashboardHref} className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" />
        Back to the dashboard
      </Link>
      {component === undefined ? <p className="text-muted-foreground">Not in the last Scan.</p> : <ComponentDetails component={component} />}
    </div>
  );
}

// The page's `searchParams`, as Next passes them, as `URLSearchParams`.
function searchParamsFrom(searchParams: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, values] of Object.entries(searchParams)) for (const value of [values ?? []].flat()) params.append(name, value);
  return params;
}

// Everything the last Scan has of `component`: what it is and the dates of
// its Release Cycle, across the page, with its Status and Drift in a column
// at least 24rem wide, or as wide as they need, at the page's right edge,
// under them on narrow screens.
function ComponentDetails({ component }: { component: ComponentRow }) {
  return (
    <>
      <h1 className="font-mono text-2xl font-semibold break-all">{component.identifier}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,auto)]">
        <div className="flex flex-col gap-6">
          <Details
            title="Component"
            rows={[
              ["Service", component.service],
              ["Product", component.product],
              ["Region", component.region],
              ["Identifier", <span className="font-mono whitespace-nowrap">{component.identifier}</span>],
              ["Version", component.version && <span className="font-mono">{component.version}</span>],
              ["Release Cycle", component.releaseCycle && <span className="font-mono">{component.releaseCycle}</span>],
            ]}
          />
          <Details
            title="Support dates"
            rows={[
              ["Cycle released", component.cycleReleaseDate],
              ["Active support ends", component.activeSupportEnd],
              // A Current Component with no End of life shows that none is
              // announced; any other has nothing to show.
              [
                "End of life",
                (component.endOfLife !== undefined || component.status === "Current") && (
                  <DateWithSources component={component} field="endOfLife" />
                ),
              ],
              ["Extended Support ends", component.extendedSupportEnd && <DateWithSources component={component} field="extendedSupportEnd" />],
              ["At End of life", component.extendedSupport],
            ]}
          />
        </div>
        <Details
          title="Status"
          labelsFit
          rows={[
            ["Status", <StatusCell component={component} />],
            ["Drift", <DriftFigures drift={component.drift} />],
          ]}
        />
      </div>
    </>
  );
}

// A titled list of `rows`, each a label and what the Component has for it,
// or "None" when it has nothing. Its labels take 12rem, so that the lists in
// one column line up, or, `labelsFit`, only as much as the longest needs. A
// value too wide for its list, as a long identifier on a narrow screen,
// scrolls rather than wrapping or running out of the list.
function Details({ title, rows, labelsFit = false }: { title: string; rows: [string, ReactNode][]; labelsFit?: boolean }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{title}</h2>
      <dl
        className={cn(
          "grid gap-x-6 gap-y-2 rounded-lg border p-4 text-sm",
          labelsFit ? "grid-cols-[max-content_minmax(0,1fr)]" : "grid-cols-[12rem_minmax(0,1fr)]",
        )}
      >
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="overflow-x-auto">{value === undefined || value === null || value === false || value === "" ? <span className="text-muted-foreground">None</span> : value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
