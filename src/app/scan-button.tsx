"use client";

import { RefreshCw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { scan } from "./actions.ts";

// Runs a Scan. It waits while a Scan or Discovery runs, `busy`.
export function ScanButton({ busy }: { busy: boolean }) {
  return (
    <form action={scan}>
      <Submit busy={busy} />
    </form>
  );
}

function Submit({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={busy || pending}>
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Scanning" : "Scan now"}
    </Button>
  );
}
