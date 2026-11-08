import { readFile } from "node:fs/promises";
import path from "node:path";
import { type AccountConfig, DEFAULT_ACCOUNT_CONFIG, parseAccountConfig } from "../awol/account-config.ts";
import { ifExists } from "../fs.ts";

export function defaultConfigDir(home: string): string {
  return path.join(home, ".config", "awol");
}

// An account's configuration: the one its file gives, the default when it
// has none, or, for a file that is not a configuration, the file's path and
// why.
export type LoadedConfig = { kind: "loaded"; config: AccountConfig } | { kind: "invalid"; path: string; error: string };

// Whether a Scan of an account with `loaded` reads tags: unless it reads
// Environments and Projects from identifiers. A file that is not a
// configuration may be meant to read tags, so its account reads them, and
// its last tags are there once the file is fixed.
export function readsTags(loaded: LoadedConfig): boolean {
  return loaded.kind === "invalid" || loaded.config.source.kind === "tags";
}

// Each AWS account's configuration, which its user writes by hand to
// `accounts/<account ID>.json` and awol only ever reads.
export function openConfig(configDir: string) {
  return {
    async account(accountId: string): Promise<LoadedConfig> {
      // The account ID names a file, so anything but one is refused.
      if (!/^\d{12}$/.test(accountId)) throw new Error(`not an AWS account ID: ${JSON.stringify(accountId)}`);
      const file = path.join(configDir, "accounts", `${accountId}.json`);
      const text = await ifExists(readFile(file, "utf8"));
      if (text === undefined) return { kind: "loaded", config: DEFAULT_ACCOUNT_CONFIG };
      const parsed = parseAccountConfig(text);
      return "error" in parsed ? { kind: "invalid", path: file, error: parsed.error } : { kind: "loaded", config: parsed.config };
    },
  };
}
