import type { ComponentRow, LastScan } from "./page-model.ts";

// The service, region and identifier in the path of a Component's page, as
// its route reads them: URL-encoded, as Next passes a page its params.
export type ComponentPathParams = { service: string; region: string; identifier: string };

// The path of `component`'s page, by the service, region and identifier that
// tell it apart from every other Component of a Scan.
export function componentPathOf({ service, region, identifier }: ComponentRow): string {
  return `/components/${[service, region, identifier].map(encodeURIComponent).join("/")}`;
}

// The Component of `scan` whose page is at the path with `params`, if it has
// one. Params that do not decode are no Component's.
export function componentAt(scan: LastScan, params: ComponentPathParams): ComponentRow | undefined {
  let service: string, region: string, identifier: string;
  try {
    [service, region, identifier] = [params.service, params.region, params.identifier].map(decodeURIComponent) as [string, string, string];
  } catch {
    return undefined;
  }
  return scan.components.find(
    (component) => component.service === service && component.region === region && component.identifier === identifier,
  );
}
