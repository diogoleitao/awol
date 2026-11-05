import type { Service } from "./component.ts";
import type { ComponentRow, LastScan } from "./page-model.ts";
import { countsOf, STATUSES, type Status } from "./status.ts";

// The values chosen in each column the dashboard's table filters on, or the
// values each column offers. A Component shows when its value is among the
// chosen ones in each column with a choice; an empty list is no choice.
export type Filters = { services: Service[]; products: string[]; regions: string[]; statuses: Status[] };

export const NO_FILTERS: Filters = { services: [], products: [], regions: [], statuses: [] };

// The values each filter offers: the services, Products and regions of the
// Components of `scan`, in alphabetical order, and every Status, most urgent
// first.
export function filterOptionsOf(scan: LastScan): Filters {
  const valuesOf = <T extends string>(value: (component: ComponentRow) => T) =>
    [...new Set(scan.components.map(value))].sort();
  return {
    services: valuesOf(({ service }) => service),
    products: valuesOf(({ product }) => product),
    regions: valuesOf(({ region }) => region),
    statuses: STATUSES,
  };
}

// A run of the dashboard's rows, under `key`: the Components of one Product
// and Release Cycle, with no Release Cycle for its Untracked ones, or,
// ungrouped, every Component shown.
export type ComponentGroup = { key: string; product?: string; releaseCycle?: string; components: ComponentRow[] };

// The last Scan as the dashboard's table shows it: how many of the
// Components it shows have each Status, and its rows.
export type DashboardView = { counts: Record<Status, number>; groups: ComponentGroup[] };

// The Components of `scan` that pass `filters`, in the last Scan's order,
// most urgent first. A chosen value `scan` does not offer, as one kept from
// before a Scan that no longer finds it, is no choice. `grouped` groups them
// by Product and Release Cycle, each group where its most urgent Component
// is, keeping that order inside it. It reads nothing but `scan`.
export function dashboardViewOf(scan: LastScan, filters: Filters, grouped: boolean): DashboardView {
  const offered = filterOptionsOf(scan);
  const components = scan.components.filter(
    (component) =>
      passes(filters.services, offered.services, component.service) &&
      passes(filters.products, offered.products, component.product) &&
      passes(filters.regions, offered.regions, component.region) &&
      passes(filters.statuses, offered.statuses, component.status),
  );
  return {
    counts: countsOf(components),
    groups: grouped ? byReleaseCycle(components) : [{ key: "all", components }],
  };
}

// Whether `value` passes a column's filter of `chosen` values, among those
// `offered`.
function passes<T>(chosen: T[], offered: T[], value: T): boolean {
  const choice = chosen.filter((other) => offered.includes(other));
  return choice.length === 0 || choice.includes(value);
}

// `components` grouped by Product and Release Cycle, in the order each
// group's first Component comes in.
function byReleaseCycle(components: ComponentRow[]): ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>();
  for (const component of components) {
    const { product, releaseCycle } = component;
    const key = JSON.stringify([product, releaseCycle]);
    const group = groups.get(key) ?? { key, product, releaseCycle, components: [] };
    group.components.push(component);
    groups.set(key, group);
  }
  return [...groups.values()];
}
