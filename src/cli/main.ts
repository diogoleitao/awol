#!/usr/bin/env node
import { spawn } from "node:child_process";
import { on } from "node:events";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { openAwol } from "../awol/awol.ts";
import { awsCli } from "../aws/runner.ts";
import { defaultDataDir } from "../data/store.ts";
import { endOfLifeFetcher } from "../endoflife/fetcher.ts";
import { type Key, runCli } from "./run.ts";

const HOST = "127.0.0.1";
const PORT = 5151;

// dist/cli/main.js -> package root, where the Next.js build lives.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const dataDir = defaultDataDir(homedir());

// The keys `awol monitor` answers to, by the name readline gives them. Set
// before awol runs, as `keys` reads it while awol is awaited.
const KEYS: Record<string, Key> = { up: "up", down: "down", space: "space", return: "enter", escape: "escape", q: "q" };

process.exitCode = await runCli(process.argv.slice(2), {
  dataDir,
  url: `http://${HOST}:${PORT}`,
  server: {
    command: process.execPath,
    args: [nextBin, "start", "--hostname", HOST, "--port", String(PORT)],
    cwd: packageRoot,
  },
  startTimeoutMs: 60_000,
  stopTimeoutMs: 10_000,
  // A part is one service in one region, whose `aws` calls the CLI retries
  // when throttled.
  cancelTimeoutMs: 60_000,
  openBrowser,
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  // The `aws` CLI with the shell's active profile, endoflife.date, and the
  // real clock, as the server has.
  awol: openAwol({ aws: awsCli(), endOfLife: endOfLifeFetcher(), dataDir, clock: { now: () => new Date() } }),
  terminal: { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true, stderr: process.stderr.isTTY === true },
  width: () => process.stderr.columns,
  // https://no-color.org: set to anything but empty, it turns color off.
  color: !process.env.NO_COLOR,
  ask,
  keys,
});

// Reads the keys pressed on the terminal, with stdin in raw mode, so each
// comes as it is pressed and Ctrl-C comes as a key, until no more are
// wanted.
async function* keys(): AsyncGenerator<Key> {
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  try {
    for await (const [, key] of on(process.stdin, "keypress") as AsyncIterable<[string, { name?: string; ctrl?: boolean }]>) {
      const pressed = key.ctrl ? (key.name === "c" ? "ctrl-c" : undefined) : KEYS[key.name ?? ""];
      if (pressed !== undefined) yield pressed;
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.on("error", () => void process.stdout.write(`open ${url} in your browser\n`));
  child.unref();
}
