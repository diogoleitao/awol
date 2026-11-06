"use server";

import { revalidatePath } from "next/cache";
import { appAwol, startDiscovery } from "./app-awol.ts";

// Runs a Scan and shows its result. Credentials that have expired or need an
// SSO login leave the last Scan, and the page asks to log in again.
export async function scan(): Promise<void> {
  await appAwol().scan();
  revalidatePath("/");
}

// Starts a Discovery of every part, or of only the parts the last one could
// not read, and returns at once: the page follows it through live updates.
export async function discover(formData: FormData): Promise<void> {
  startDiscovery(formData.get("scope") === "failed" ? "failed" : "all");
  revalidatePath("/");
}
