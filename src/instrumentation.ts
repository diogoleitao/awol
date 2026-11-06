// Runs a Scan when the server starts, or a Discovery of an account awol has
// never discovered. It is not awaited: the server answers while it runs, and
// the dashboard shows the previous Scan until it ends.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startUp } = await import("./app/app-awol.ts");
  startUp();
}
