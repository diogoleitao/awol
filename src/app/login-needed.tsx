import { KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// What every page shows when the credentials of the active profile have
// expired or need an SSO login, with the `aws` CLI's reason.
export function LoginNeeded({ reason }: { reason: string }) {
  return (
    <Alert variant="destructive" className="max-w-2xl">
      <KeyRound />
      <AlertTitle>Your AWS credentials have expired or need an SSO login</AlertTitle>
      <AlertDescription>
        <p>
          Log in again with the profile active in the shell that started awol, for example with{" "}
          <code>aws sso login</code>, then reload this page.
        </p>
        <p className="font-mono text-xs">{reason}</p>
      </AlertDescription>
    </Alert>
  );
}
