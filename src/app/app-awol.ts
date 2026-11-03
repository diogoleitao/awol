import { homedir } from "node:os";
import { awsCli } from "../aws/runner.ts";
import { openAwol } from "../awol/awol.ts";
import { defaultDataDir } from "../data/store.ts";
import { endOfLifeFetcher } from "../endoflife/fetcher.ts";

// The app's entry into awol: the `aws` CLI with the shell's active profile,
// endoflife.date, the state under ~/.local/share/awol/, and the real clock.
export function appAwol() {
  return openAwol({
    aws: awsCli(),
    endOfLife: endOfLifeFetcher(),
    dataDir: defaultDataDir(homedir()),
    clock: { now: () => new Date() },
  });
}
