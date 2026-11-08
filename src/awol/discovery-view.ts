import { isOneOf } from "./dashboard-view.ts";
import type { DiscoveredServiceRow, DiscoveryResult, SupportedService } from "./page-model.ts";

// The values chosen in each filter of the Discovery page: whether a service
// is a Supported service, whether it is a Monitored service, and the
// regions. An empty list is no choice.
export type DiscoveryFilters = { support: Support[]; monitoring: Monitoring[]; regions: string[] };

export const NO_DISCOVERY_FILTERS: DiscoveryFilters = { support: [], monitoring: [], regions: [] };

// Whether a service is a Supported service, as the Discovery page's filter
// names it.
export const SUPPORT = ["Supported", "Not supported"] as const;

export type Support = (typeof SUPPORT)[number];

// Whether a service is a Monitored service, as the Discovery page's filter
// names it.
export const MONITORING = ["Monitored", "Not monitored"] as const;

export type Monitoring = (typeof MONITORING)[number];

// `filters` as the Discovery page's URL keeps them: each chosen value.
export function discoverySearchParamsOf(filters: DiscoveryFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [filter, chosen] of Object.entries(filters)) for (const value of chosen) params.append(filter, value);
  return params;
}

// The filters the Discovery page's URL `params` keep, as
// `discoverySearchParamsOf` keeps them, with any support or monitoring
// value the filters do not offer left out.
export function discoveryFiltersOf(params: URLSearchParams): DiscoveryFilters {
  return {
    support: params.getAll("support").filter((value) => isOneOf(SUPPORT, value)),
    monitoring: params.getAll("monitoring").filter((value) => isOneOf(MONITORING, value)),
    regions: params.getAll("regions"),
  };
}

// The last Discovery as the Discovery page shows it: how many values are
// chosen in each filter, and the services that pass them.
export type DiscoveryView = { chosenCounts: Record<keyof DiscoveryFilters, number>; services: DiscoveredServiceRow[] };

// The services of `discovery` that pass `filters`, in the Discovery's order,
// `monitored` being the account's Monitored services, none before any are
// chosen. With regions chosen, only services with resources in one of them
// pass, each with only its resources there and the chosen regions it is not
// in. The versions a service runs stay those across the account: Discovery
// does not read them by region. A chosen region the account does not
// enable, as one kept from before a Discovery that no longer finds it, is
// no choice.
export function discoveryViewOf(
  discovery: DiscoveryResult,
  { support, monitoring, regions }: DiscoveryFilters,
  monitored: SupportedService[] = [],
): DiscoveryView {
  const enabled = regions.filter((region) => discovery.regions.includes(region));
  const services = discovery.services
    .filter((row) => support.length === 0 || support.includes(supportOf(row)))
    .filter((row) => monitoring.length === 0 || monitoring.includes(monitoringOf(row, monitored)))
    .flatMap((row) => (enabled.length === 0 ? [row] : inRegions(row, enabled)));
  return { chosenCounts: { support: support.length, monitoring: monitoring.length, regions: enabled.length }, services };
}

// `row` with only its resources in `regions`, or nothing if it has none
// there.
function inRegions(row: DiscoveredServiceRow, regions: string[]): DiscoveredServiceRow[] {
  const found = row.regions.filter(({ region }) => regions.includes(region));
  if (found.length === 0) return [];
  return [
    {
      ...row,
      count: found.reduce((sum, { count }) => sum + count, 0),
      regions: found,
      notInRegions: row.notInRegions.filter((region) => regions.includes(region)),
    },
  ];
}

// Whether `row`'s service is a Supported service, as the filter names it.
function supportOf({ supported }: DiscoveredServiceRow): Support {
  return supported ? "Supported" : "Not supported";
}

// Whether `row`'s service is among the `monitored` ones, as the filter names
// it.
function monitoringOf({ service }: DiscoveredServiceRow, monitored: SupportedService[]): Monitoring {
  return (monitored as string[]).includes(service) ? "Monitored" : "Not monitored";
}
