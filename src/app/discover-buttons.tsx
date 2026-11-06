"use client";

import { LoaderCircle, Radar, RotateCcw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { discover } from "./actions.ts";

// Starts a Discovery of every part, from the top bar. It waits while a Scan
// or Discovery runs, `disabled`, and spins in place of its icon while a
// Discovery runs, `running`.
export function DiscoverButton({ disabled, running }: { disabled: boolean; running: boolean }) {
  return (
    <form action={discover}>
      <input type="hidden" name="scope" value="all" />
      <DiscoverSubmit disabled={disabled} running={running} />
    </form>
  );
}

// The Discover button, disabled and spinning too while its form is being
// sent.
function DiscoverSubmit({ disabled, running }: { disabled: boolean; running: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="icon-sm" aria-label="Discover" disabled={disabled || pending}>
      {running || pending ? <LoaderCircle className="animate-spin" /> : <Radar />}
    </Button>
  );
}

// Starts a Discovery of only the parts the last one could not read. It
// waits while a Scan or Discovery runs, `busy`.
export function RerunFailedPartsButton({ busy }: { busy: boolean }) {
  return (
    <form action={discover}>
      <input type="hidden" name="scope" value="failed" />
      <RerunSubmit busy={busy} />
    </form>
  );
}

// The Re-run failed parts button, disabled too while its form is being sent.
function RerunSubmit({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={busy || pending}>
      <RotateCcw />
      Re-run failed parts
    </Button>
  );
}
