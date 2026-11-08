import { type Service, SUPPORTED_BY } from "./component.ts";
import type { ComponentRow, LastScan } from "./page-model.ts";
import { STATUSES, type Status } from "./status.ts";

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

// A run of the dashboard's rows, under `key`: the Components on the page
// shown of one Product and Release Cycle, with no Release Cycle for its
// Untracked ones, or, ungrouped, of every Component that passes the filters
// and search, and how many Components it has on every page.
export type ComponentGroup = { key: string; product?: string; releaseCycle?: string; count: number; components: ComponentRow[] };

// The columns the dashboard's table sorts on: every column it shows.
export const SORT_COLUMNS = ["identifier", "product", "region", "version", "status", "endOfLife"] as const;

export type SortColumn = (typeof SORT_COLUMNS)[number];

// A column to sort the dashboard's table on, and which way.
export type Sort = { column: SortColumn; direction: "ascending" | "descending" };

// The sort after choosing `column`: ascending on a column not sorted on,
// then descending and ascending in turn.
export function nextSort(sort: Sort, column: SortColumn): Sort {
  if (sort.column !== column) return { column, direction: "ascending" };
  return { column, direction: sort.direction === "ascending" ? "descending" : "ascending" };
}

// How many Components a page of the dashboard's table can show.
export const PAGE_SIZES = [25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

// A page of the dashboard's table: its index, from 0, and its size.
export type Page = { index: number; size: PageSize };

// What the dashboard's table is set to show: its filters, its search,
// whether it groups, its sort, and its page.
export type TableState = { filters: Filters; search: string; grouped: boolean; sort: Sort; page: Page };

// The table at first: by Status, most urgent first.
export const INITIAL_TABLE_STATE: TableState = {
  filters: NO_FILTERS,
  search: "",
  grouped: false,
  sort: { column: "status", direction: "ascending" },
  page: { index: 0, size: 25 },
};

// `state` as the dashboard's URL keeps it: each chosen filter value, the
// search, grouping, the sort and its direction, the page, counted from 1,
// and its size, leaving out each that is as it is at first.
export function searchParamsOf({ filters, search, grouped, sort, page }: TableState): URLSearchParams {
  const params = new URLSearchParams();
  for (const [column, chosen] of Object.entries(filters)) for (const value of chosen) params.append(column, value);
  if (search !== "") params.set("search", search);
  if (grouped) params.set("grouped", "true");
  if (sort.column !== INITIAL_TABLE_STATE.sort.column || sort.direction !== INITIAL_TABLE_STATE.sort.direction) {
    params.set("sort", sort.column);
    params.set("direction", sort.direction);
  }
  if (page.index > 0) params.set("page", String(page.index + 1));
  if (page.size !== INITIAL_TABLE_STATE.page.size) params.set("size", String(page.size));
  return params;
}

// The state the dashboard's URL `params` keep, as `searchParamsOf` keeps it,
// with each part the table does not offer, such as an unknown Status or
// page size, as it is at first.
export function tableStateOf(params: URLSearchParams): TableState {
  const column = oneOf(SORT_COLUMNS, params.get("sort"));
  const direction = oneOf(DIRECTIONS, params.get("direction"));
  const page = Number(params.get("page"));
  return {
    filters: {
      services: params.getAll("services").filter((service) => isOneOf(SERVICES, service)),
      products: params.getAll("products"),
      regions: params.getAll("regions"),
      statuses: params.getAll("statuses").filter((status) => isOneOf(STATUSES, status)),
    },
    search: params.get("search") ?? "",
    grouped: params.get("grouped") === "true",
    sort: column !== undefined && direction !== undefined ? { column, direction } : INITIAL_TABLE_STATE.sort,
    page: {
      index: Number.isInteger(page) && page > 1 ? page - 1 : 0,
      size: oneOf(PAGE_SIZES, Number(params.get("size"))) ?? INITIAL_TABLE_STATE.page.size,
    },
  };
}

// `path` with `query`, a URL's query string without its `?`, if there is one.
export function withQuery(path: string, query: string): string {
  return query === "" ? path : `${path}?${query}`;
}

const SERVICES = Object.keys(SUPPORTED_BY) as Service[];

const DIRECTIONS = ["ascending", "descending"] as const;

// Whether `value` is one of `values`.
export function isOneOf<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

// `value` if it is one of `values`.
function oneOf<T>(values: readonly T[], value: unknown): T | undefined {
  return isOneOf(values, value) ? value : undefined;
}

// The last Scan as the dashboard's table shows it: how many values are
// chosen in each filter, its rows on the page shown, that page's index out
// of how many pages, and which of the Components that pass the filters and
// search it shows, counted from 1.
export type DashboardView = {
  chosenCounts: Record<keyof Filters, number>;
  groups: ComponentGroup[];
  page: number;
  pages: number;
  range: { from: number; to: number; of: number };
};

// The Components of `scan` that pass `state`'s filters and search, on
// `state`'s page. A chosen value `scan` does not offer, as one kept from
// before a Scan that no longer finds it, is no choice.
//
// They come sorted on `state`'s column, with ties in the last Scan's
// Urgency order. Grouped, they are grouped by Product
// and Release Cycle, each group where its first Component is, keeping that
// order inside it, and a group can go on from one page to the next. A page
// past the last shows the last.
//
// It reads nothing but `scan`.
export function dashboardViewOf(scan: LastScan, { filters, search, grouped, sort, page }: TableState): DashboardView {
  const offered = filterOptionsOf(scan);
  const components = scan.components.filter(
    (component) =>
      passes(filters.services, offered.services, component.service) &&
      passes(filters.products, offered.products, component.product) &&
      passes(filters.regions, offered.regions, component.region) &&
      passes(filters.statuses, offered.statuses, component.status) &&
      matches(search, component),
  );
  components.sort(compareOn(sort));
  const pages = Math.max(1, Math.ceil(components.length / page.size));
  const index = Math.min(page.index, pages - 1);
  const from = index * page.size;
  const to = Math.min(from + page.size, components.length);
  const groups = grouped ? byReleaseCycle(components) : [{ key: "all", count: components.length, components }];
  return {
    chosenCounts: {
      services: choiceOf(filters.services, offered.services).length,
      products: choiceOf(filters.products, offered.products).length,
      regions: choiceOf(filters.regions, offered.regions).length,
      statuses: choiceOf(filters.statuses, offered.statuses).length,
    },
    groups: onPage(groups, from, to),
    page: index,
    pages,
    range: { from: from + 1, to, of: components.length },
  };
}

// `groups` with only their Components from the `from`th to before the `to`th,
// counted from 0 across groups, and the groups with none left out.
function onPage(groups: ComponentGroup[], from: number, to: number): ComponentGroup[] {
  let start = 0;
  return groups.flatMap((group) => {
    const components = group.components.slice(Math.max(0, from - start), Math.max(0, to - start));
    start += group.count;
    return components.length === 0 ? [] : [{ ...group, components }];
  });
}

// Orders Components on `sort`'s column, those with no value in it last
// either way.
function compareOn({ column, direction }: Sort): (a: ComponentRow, b: ComponentRow) => number {
  return (a, b) => {
    const x = a[column];
    const y = b[column];
    if (x === undefined || y === undefined) return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0);
    const order = COMPARE[column](x, y);
    return direction === "ascending" ? order : -order;
  };
}

// How each column orders two values: Status in Status order, from AWOL to
// Untracked, versions by their numbers, so 8.0.40 comes before 8.0.100 and
// python3.8 before python3.12, and text, and dates with it, alphabetically.
const COMPARE: Record<SortColumn, (a: string, b: string) => number> = {
  identifier: alphabetically,
  product: alphabetically,
  region: alphabetically,
  version: byNumbers,
  status: (a, b) => STATUSES.indexOf(a as Status) - STATUSES.indexOf(b as Status),
  endOfLife: alphabetically,
};

function byNumbers(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

function alphabetically(a: string, b: string): number {
  return a.localeCompare(b, "en");
}

// Whether `value` passes a column's filter of `chosen` values, among those
// `offered`.
function passes<T>(chosen: T[], offered: T[], value: T): boolean {
  const choice = choiceOf(chosen, offered);
  return choice.length === 0 || choice.includes(value);
}

// The `chosen` values of a column's filter that are among those `offered`.
function choiceOf<T>(chosen: T[], offered: T[]): T[] {
  return chosen.filter((value) => offered.includes(value));
}

// Whether every word of `search` is in `component`'s identifier, version or
// Release Cycle, whatever its case. A search of no words is no search.
function matches(search: string, { identifier, version, releaseCycle }: ComponentRow): boolean {
  const texts = [identifier, version, releaseCycle].flatMap((text) => (text === undefined ? [] : [text.toLowerCase()]));
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "")
    .every((word) => texts.some((text) => text.includes(word)));
}

// `components` grouped by Product and Release Cycle, in the order each
// group's first Component comes in.
function byReleaseCycle(components: ComponentRow[]): ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>();
  for (const component of components) {
    const { product, releaseCycle } = component;
    const key = JSON.stringify([product, releaseCycle]);
    const group = groups.get(key) ?? { key, product, releaseCycle, count: 0, components: [] };
    group.components.push(component);
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()];
}
