import { KeyRound } from "lucide-react";
import { connection } from "next/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { appAwol } from "./app-awol.ts";

export default async function DashboardPage() {
  await connection();
  const model = await appAwol().pageModel();

  if (model.kind === "login-needed") {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <KeyRound />
        <AlertTitle>Your AWS credentials have expired or need an SSO login</AlertTitle>
        <AlertDescription>
          <p>
            Log in again with the profile active in the shell that started awol, for example with{" "}
            <code>aws sso login</code>, then reload this page.
          </p>
          <p className="font-mono text-xs">{model.reason}</p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <p>
      <span className="text-muted-foreground">AWS account</span>{" "}
      <span className="font-mono">{model.accountId}</span>
    </p>
  );
}
