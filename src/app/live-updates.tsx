"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// How long the tab gathers changes before it refreshes, so a Discovery that
// keeps many parts at once refreshes it once for them.
const REFRESH_DELAY_MS = 500;

// Refreshes the page after every change the server streams, such as each
// part a Discovery keeps.
export function LiveUpdates() {
  const router = useRouter();

  useEffect(() => {
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const events = new EventSource("/events");
    events.onmessage = () => {
      refresh ??= setTimeout(() => {
        refresh = undefined;
        router.refresh();
      }, REFRESH_DELAY_MS);
    };
    return () => {
      events.close();
      clearTimeout(refresh);
    };
  }, [router]);

  return null;
}
