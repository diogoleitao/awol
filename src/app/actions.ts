"use server";

import { revalidatePath } from "next/cache";
import { SUPPORTED_SERVICES } from "../awol/component.ts";
import { appAwol, startDiscovery } from "./app-awol.ts";

// Keeps the services ticked on the form as the account's Monitored services.
// Credentials that have expired or need an SSO login leave them as they were,
// and the page asks to log in again.
export async function chooseMonitoredServices(formData: FormData): Promise<void> {
  const ticked = formData.getAll("service");
  await appAwol().setMonitoredServices(SUPPORTED_SERVICES.filter((service) => ticked.includes(service)));
  revalidatePath("/");
}

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
