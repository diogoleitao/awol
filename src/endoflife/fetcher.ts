// One answer of endoflife.date's API: the status, the ETag to send back as
// If-None-Match next time, and the body, empty on a 304.
export type EndOfLifeResponse = { status: number; etag?: string; body: string };

// Fetches one endoflife.date API URL, sending `etag` as If-None-Match when
// given. Tests swap in a fetcher that replays recorded responses.
export type EndOfLifeFetcher = (url: string, etag?: string) => Promise<EndOfLifeResponse>;

export function endOfLifeFetcher(): EndOfLifeFetcher {
  return async (url, etag) => {
    const response = await fetch(url, {
      headers: etag === undefined ? {} : { "If-None-Match": etag },
      redirect: "follow",
    });
    return { status: response.status, etag: response.headers.get("ETag") ?? undefined, body: await response.text() };
  };
}
