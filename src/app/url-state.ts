"use client";

import { useSearchParams } from "next/navigation";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { withQuery } from "../awol/dashboard-view.ts";

// State a page keeps in its URL: read from the URL at first with `read`, and
// written back to it with `write` on each change, replacing it rather than
// adding to the history, so that going back to the page, reloading it or
// opening a link to it shows the state as it was. It comes with its query
// string, without its `?`.
export function useUrlState<S>(
  read: (params: URLSearchParams) => S,
  write: (state: S) => URLSearchParams,
): [S, Dispatch<SetStateAction<S>>, string] {
  const searchParams = useSearchParams();
  const [state, setState] = useState<S>(() => read(new URLSearchParams(searchParams)));
  const query = write(state).toString();

  useEffect(() => {
    window.history.replaceState(null, "", withQuery(window.location.pathname, query));
  }, [query]);

  return [state, setState, query];
}

// `filters` with `value` chosen in the filter `filter`, or unchosen if it
// was.
export function toggledIn<F extends Record<string, readonly string[]>, K extends keyof F>(filters: F, filter: K, value: F[K][number]): F {
  const chosen = filters[filter];
  return { ...filters, [filter]: chosen.includes(value) ? chosen.filter((other) => other !== value) : [...chosen, value] };
}
