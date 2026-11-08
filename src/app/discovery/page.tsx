import { connection } from "next/server";
import { busyOf } from "../../awol/top-bar.ts";
import { discoveryRunning, pageModel } from "../app-awol.ts";
import { DiscoverySection } from "../discovery-section.tsx";
import { LoginNeeded } from "../login-needed.tsx";

// The account's last Discovery, with a sidebar of its filters.
export default async function DiscoveryPage() {
  await connection();
  const model = await pageModel();

  if (model.kind === "login-needed") return <LoginNeeded reason={model.reason} />;

  if (model.discovery === undefined) {
    return <p className="text-muted-foreground">No Discovery yet. Run one from the top bar.</p>;
  }
  return <DiscoverySection discovery={model.discovery} monitored={model.monitoredServices} busy={busyOf(model, discoveryRunning())} />;
}
