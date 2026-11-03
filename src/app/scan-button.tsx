"use client";

import { RefreshCw } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { scan } from "./actions.ts";

export function ScanButton() {
  return (
    <form action={scan}>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Scanning" : "Scan now"}
    </Button>
  );
}
