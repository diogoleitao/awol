"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { scan } from "./actions.ts";

// Runs a Scan, from the top bar. It waits while a Scan or Discovery runs, or
// until Monitored services are chosen, `disabled`, and spins in place of its
// icon while a Scan runs, `running`.
export function ScanButton({ disabled, running }: { disabled: boolean; running: boolean }) {
  return (
    <form action={scan}>
      <Submit disabled={disabled} running={running} />
    </form>
  );
}

// The Scan button, spinning too while its form is being sent.
function Submit({ disabled, running }: { disabled: boolean; running: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="icon-sm" aria-label="Scan now" disabled={disabled || pending}>
      {running || pending ? <LoaderCircle className="animate-spin" /> : <Search />}
    </Button>
  );
}
