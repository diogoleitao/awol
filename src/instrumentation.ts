// Runs a Scan when the server starts. It is not awaited: the server answers
// while it runs, and the dashboard shows the previous Scan until it ends.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { appAwol } = await import("./app/app-awol.ts");
  appAwol()
    .scan()
    .catch((error: unknown) => console.error("awol: the Scan on start failed:", error));
}
