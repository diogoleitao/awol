"use server";

import { revalidatePath } from "next/cache";
import { appAwol } from "./app-awol.ts";

// Runs a Scan and shows its result. Credentials that have expired or need an
// SSO login leave the last Scan, and the page asks to log in again.
export async function scan(): Promise<void> {
  await appAwol().scan();
  revalidatePath("/");
}
