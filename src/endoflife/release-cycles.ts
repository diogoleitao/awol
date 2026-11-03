import { readFile } from "node:fs/promises";
import path from "node:path";
import { ifExists, writeFileAtomically } from "../fs.ts";
import type { EndOfLifeFetcher } from "./fetcher.ts";

// One Release Cycle of a Product as endoflife.date gives it, with the dates it
// has.
export type ReleaseCycle = {
  name: string;
  releaseDate?: string;
  activeSupportEnd?: string;
  endOfLife?: string;
  extendedSupportEnd?: string;
};

// The last answer endoflife.date gave for one product, kept to send its ETag
// back and to reuse on a 304.
type CachedProduct = { etag: string; body: string };

// One release in endoflife.date's API: `eoasFrom` is the end of Active
// support, `eolFrom` End of life, and `eoesFrom` the end of Extended Support.
type Release = { name: string; releaseDate?: unknown; eoasFrom?: unknown; eolFrom?: unknown; eoesFrom?: unknown };

// The Release Cycles of endoflife.date's products, cached under
// `endoflife/<product>.json` in the data directory. The cache is not per
// account: every account reads the same lifecycles.
export function openReleaseCycles(fetcher: EndOfLifeFetcher, dataDir: string) {
  return async function releaseCycles(endOfLifeProduct: string): Promise<ReleaseCycle[]> {
    const cachePath = path.join(dataDir, "endoflife", `${endOfLifeProduct}.json`);
    const text = await ifExists(readFile(cachePath, "utf8"));
    const cached = text === undefined ? undefined : (JSON.parse(text) as CachedProduct);

    const response = await fetcher(`https://endoflife.date/api/v1/products/${endOfLifeProduct}`, cached?.etag);
    let body: string;
    if (response.status === 304 && cached !== undefined) {
      body = cached.body;
    } else if (response.status === 200) {
      body = response.body;
      if (response.etag !== undefined) {
        await writeFileAtomically(cachePath, `${JSON.stringify({ etag: response.etag, body } satisfies CachedProduct)}\n`);
      }
    } else {
      throw new Error(`endoflife.date answered ${response.status} for ${endOfLifeProduct}`);
    }

    const releases = (JSON.parse(body) as { result: { releases: Release[] } }).result.releases;
    return releases.map((release) => ({
      name: release.name,
      releaseDate: date(release.releaseDate),
      activeSupportEnd: date(release.eoasFrom),
      endOfLife: date(release.eolFrom),
      extendedSupportEnd: date(release.eoesFrom),
    }));
  };
}

// A date endoflife.date gives, or undefined for null or anything but a date.
function date(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
