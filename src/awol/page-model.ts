// What the dashboard shows: the AWS account of the active profile, or, when
// its credentials have expired or need an SSO login, the `aws` CLI's reason.
export type PageModel =
  | { kind: "signed-in"; accountId: string }
  | { kind: "login-needed"; reason: string };
