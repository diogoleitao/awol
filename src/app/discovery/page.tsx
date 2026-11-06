import { Eye, Globe } from "lucide-react";
import { connection } from "next/server";
import { busyOf } from "../../awol/top-bar.ts";
import { discoveryRunning, pageModel } from "../app-awol.ts";
import { DiscoverySection } from "../discovery-section.tsx";
import { LoginNeeded } from "../login-needed.tsx";
import { MonitoredServicesForm } from "../monitored-services-form.tsx";
import { RegionsCard } from "../regions-card.tsx";
import { SidebarLayout } from "../sidebar-layout.tsx";

// The account's last Discovery, with a sidebar of its Monitored services,
// chosen from what that Discovery found, and the regions it read.
export default async function DiscoveryPage() {
  await connection();
  const model = await pageModel();

  if (model.kind === "login-needed") return <LoginNeeded reason={model.reason} />;

  if (model.discovery === undefined) {
    return <p className="text-muted-foreground">No Discovery yet. Run one from the top bar.</p>;
  }
  return (
    <SidebarLayout
      sections={[
        { name: "Regions", icon: <Globe /> },
        { name: "Monitoring", icon: <Eye /> },
      ]}
      sidebar={
        <>
          <RegionsCard regions={model.discovery.regions} />
          <MonitoredServicesForm
            services={model.discovery.services.filter(({ supported }) => supported)}
            monitored={model.monitoredServices}
          />
        </>
      }
    >
      <DiscoverySection discovery={model.discovery} busy={busyOf(model, discoveryRunning())} />
    </SidebarLayout>
  );
}
