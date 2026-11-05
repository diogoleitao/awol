import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ifExists, writeFileAtomically } from "../fs.ts";
import { failedRead, type PartRead } from "../part-read.ts";
import type { EndOfLifeFetcher, EndOfLifeResponse } from "./fetcher.ts";

// One Release Cycle of a Product as endoflife.date gives it, with its Latest
// patch and the dates it has.
export type ReleaseCycle = {
  name: string;
  latest?: string;
  releaseDate?: string;
  activeSupportEnd?: string;
  endOfLife?: string;
  extendedSupportEnd?: string;
};

// The last answer endoflife.date gave for one product, kept to send its ETag
// back, to reuse on a 304, and to use when endoflife.date fails, with when it
// was last read successfully. A copy kept before awol recorded that has no
// `readAt`.
type CachedProduct = { etag?: string; body: string; readAt?: string };

// One release in endoflife.date's API: `latest` is the Latest patch,
// `eoasFrom` the end of Active support, `eolFrom` End of life, and `eoesFrom`
// the end of Extended Support.
type Release = {
  name: string;
  latest?: { name?: unknown } | null;
  releaseDate?: unknown;
  eoasFrom?: unknown;
  eolFrom?: unknown;
  eoesFrom?: unknown;
};

// The Release Cycles of endoflife.date's products, read on `now`, cached
// under `endoflife/<product>.json` in the data directory. The cache is not
// per account: every account reads the same lifecycles. A product
// endoflife.date fails for keeps its last answer, if there is one.
export function openReleaseCycles(fetcher: EndOfLifeFetcher, dataDir: string) {
  return async function releaseCycles(endOfLifeProduct: string, now: Date): Promise<PartRead<ReleaseCycle[]>> {
    const cachePath = path.join(dataDir, "endoflife", `${endOfLifeProduct}.json`);
    const text = await ifExists(readFile(cachePath, "utf8"));
    const cached = text === undefined ? undefined : (JSON.parse(text) as CachedProduct);

    const failed = async (error: string): Promise<PartRead<ReleaseCycle[]>> => {
      if (cached === undefined) return { error };
      // A copy kept before awol recorded when it read it was written on its
      // last 200, the last time awol read it in full.
      const readAt = cached.readAt ?? (await stat(cachePath)).mtime.toISOString();
      return failedRead(error, { result: releaseCyclesOf(cached.body), readAt });
    };

    let response: EndOfLifeResponse;
    try {
      response = await fetcher(`https://endoflife.date/api/v1/products/${endOfLifeProduct}`, cached?.etag);
    } catch (failure) {
      return failed(`endoflife.date could not be reached for ${endOfLifeProduct}: ${(failure as Error).message}`);
    }
    const body = response.status === 304 ? cached?.body : response.status === 200 ? response.body : undefined;
    if (body === undefined) return failed(`endoflife.date answered ${response.status} for ${endOfLifeProduct}`);

    const readAt = now.toISOString();
    const etag = response.status === 304 ? cached?.etag : response.etag;
    await writeFileAtomically(cachePath, `${JSON.stringify({ etag, body, readAt } satisfies CachedProduct)}\n`);
    return { result: releaseCyclesOf(body), readAt };
  };
}

// The Release Cycles in one of endoflife.date's product answers.
function releaseCyclesOf(body: string): ReleaseCycle[] {
  const releases = (JSON.parse(body) as { result: { releases: Release[] } }).result.releases;
  return releases.map((release) => ({
    name: release.name,
    latest: typeof release.latest?.name === "string" ? release.latest.name : undefined,
    releaseDate: date(release.releaseDate),
    activeSupportEnd: date(release.eoasFrom),
    endOfLife: date(release.eolFrom),
    extendedSupportEnd: date(release.eoesFrom),
  }));
}

// A date endoflife.date gives, or undefined for null or anything but a date.
function date(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
