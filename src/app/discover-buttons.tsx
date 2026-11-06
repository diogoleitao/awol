"use client";

import { Radar, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { discover } from "./actions.ts";

// Starts a Discovery of every part and, when the last one has failed or
// Stale parts, of only those. Both wait while a Scan or Discovery runs.
export function DiscoverButtons({ running, anyFailed }: { running: boolean; anyFailed: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <form action={discover}>
        <input type="hidden" name="scope" value="all" />
        <Submit running={running} icon={<Radar />} label="Discover" />
      </form>
      {anyFailed && (
        <form action={discover}>
          <input type="hidden" name="scope" value="failed" />
          <Submit running={running} icon={<RotateCcw />} label="Re-run failed parts" />
        </form>
      )}
    </div>
  );
}

function Submit({ running, icon, label }: { running: boolean; icon: ReactNode; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={running || pending}>
      {icon}
      {label}
    </Button>
  );
}
