import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  type Awol,
  type Busy,
  type DiscoveryOutcome,
  type Part,
  type Progress,
  type ScanOutcome,
  type Step,
} from "../awol/awol.ts";
import type { Running } from "../awol/page-model.ts";
import type { DiscoveryScope } from "../awol/discovery.ts";
import { SUPPORTED_SERVICES, type SupportedService } from "../awol/component.ts";
import { STATUSES, type Status } from "../awol/status.ts";
import { openServerRecord, type ServerRecord } from "../data/server-record.ts";
import { isAlive } from "../process.ts";

export type CliDeps = {
  dataDir: string;
  url: string;
  // What runs the server; it must listen on `url`.
  server: { command: string; args: string[]; cwd: string };
  // How long `awol start` waits for the server to answer before stopping it.
  startTimeoutMs: number;
  // How long a stopped server, or an `awol scan` or `awol discover` stopped
  // by --force, gets to exit before it is killed.
  stopTimeoutMs: number;
  // How long --force waits for a Scan or Discovery the server runs to stop
  // at its next part once asked to.
  cancelTimeoutMs: number;
  openBrowser: (url: string) => void;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  // What `awol discover` and `awol scan` run, on the same data directory.
  awol: Awol;
  // Which streams are a terminal: a question needs stdin and stdout, and
  // the progress bar stderr. Output to a terminal has ticks and a summary
  // laid out, and to anything else is plain lines.
  terminal: { stdin: boolean; stdout: boolean; stderr: boolean };
  // How many columns wide stderr's terminal is now, if it is one, so a line
  // drawn over and over never wraps.
  width: () => number | undefined;
  // Whether output to a terminal is colored: not when NO_COLOR is set.
  color: boolean;
  // Asks `question` on the terminal, giving the answer.
  ask: (question: string) => Promise<string>;
  // Reads the keys pressed on the terminal, one at a time as each is
  // pressed, until no more are wanted.
  keys: () => AsyncIterable<Key>;
};

// A key pressed on the terminal that `awol monitor` answers to.
export type Key = "up" | "down" | "space" | "enter" | "escape" | "q" | "ctrl-c";

type ServerRecordFile = ReturnType<typeof openServerRecord>;

const execFileAsync = promisify(execFile);

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...options] = argv;
  // Whether every option is one of `allowed`, each given once.
  const only = (...allowed: string[]) => new Set(options).size === options.length && options.every((option) => allowed.includes(option));
  const force = options.includes("--force");
  if (command === "start") return runStart(deps);
  if (command === "stop") return runStop(deps);
  if (command === "discover" && only("--failed", "--force")) return runDiscover(deps, options.includes("--failed") ? "failed" : "all", force);
  if (command === "scan" && only("--force")) return runScan(deps, force);
  if (command === "monitor" && only()) return runMonitor(deps);
  deps.stderr("usage: awol start | awol stop | awol discover [--failed] [--force] | awol scan [--force] | awol monitor\n");
  return 2;
}

// What a forced Scan or Discovery ends in when the one running inside the
// server did not stop in time when asked to.
type NotStopped = { kind: "not-stopped"; busy: Busy };

// Runs `run` and, when `force` is given and a Scan or Discovery of the
// account is running, stops it and runs again. One the server runs is asked
// to stop at its next part, leaving the server running. An `awol scan` or
// `awol discover` is stopped as a process; one whose process is no longer
// awol, its pid given to another, is taken over without being stopped.
async function forcing<O extends { kind: string }>(
  deps: CliDeps,
  force: boolean,
  run: (takeOver?: number) => Promise<O | Busy>,
): Promise<O | Busy | NotStopped> {
  const outcome = await run();
  if (!force || !isBusy(outcome)) return outcome;
  const { running, pid } = outcome;
  if (!inTerminal(running)) {
    if (!(await spinning(deps, `Cancelling ${nameOf(running)}…`, deps.awol.cancel(outcome, deps.cancelTimeoutMs)))) {
      return { kind: "not-stopped", busy: outcome };
    }
    done(deps, `Cancelled ${nameOf(running)}`);
    return run();
  }
  if (await isAwolRun(pid)) {
    await spinning(deps, `Stopping ${nameOf(running)}…`, stopProcess(pid, deps.stopTimeoutMs));
    done(deps, `Stopped ${nameOf(running)}`);
  } else {
    done(deps, "Took over a stale lock");
  }
  return run(pid);
}

// Whether `awol scan` or `awol discover` started `running`.
function inTerminal({ startedBy }: Running): boolean {
  return startedBy === "awol scan" || startedBy === "awol discover";
}

// The Scan or Discovery `running`, named by who started it.
function nameOf(running: Running): string {
  if (running.startedBy === "the dashboard") return `the dashboard's ${running.operation}`;
  if (running.startedBy === "the server on start") return `the server's ${running.operation}`;
  return `the ${running.operation} in another terminal`;
}

// Which Scan or Discovery of the account is running, when and where it
// started, and how to stop it.
function alreadyRunning({ running }: Busy): string {
  const where = inTerminal(running) ? "in another terminal" : running.startedBy === "the dashboard" ? "from the dashboard" : "by the server";
  const at = new Date(running.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `a ${running.operation} is already running (started ${at} ${where}); use --force to stop it`;
}

// The frames of the spinner, turning.
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

// Waits for `work`, with `text` behind a spinner on stderr while it runs,
// when stderr is a terminal, cleared once it is done. The line is cut to the
// terminal's width, since only its last row is cleared before each frame.
async function spinning<T>({ terminal, width, color, stderr }: CliDeps, text: string, work: Promise<T>): Promise<T> {
  if (!terminal.stderr) return work;
  const look = lookOf(true, color);
  let frame = 0;
  const draw = () => {
    // The spinner and the space after it take two columns, and the last
    // column is left empty, as some terminals wrap on reaching it.
    const room = (width() ?? 80) - 3;
    const fitted = text.length > room ? `${text.slice(0, room - 1)}…` : text;
    stderr(`${CLEAR_LINE}${look.cyan(SPINNER[frame++ % SPINNER.length]!)} ${fitted}`);
  };
  draw();
  const turning = setInterval(draw, 80);
  try {
    return await work;
  } finally {
    clearInterval(turning);
    stderr(CLEAR_LINE);
  }
}

// Prints `text` on stdout as a step done before the run, ticked on a
// terminal.
function done({ terminal, color, stdout }: CliDeps, text: string) {
  const look = lookOf(terminal.stdout, color);
  stdout(`${look.fancy ? `${look.green("✔")} ` : ""}${text}\n`);
}

function isBusy(outcome: { kind: string }): outcome is Busy {
  return outcome.kind === "busy";
}

// Whether `pid` runs `awol scan` or `awol discover`, by its command line.
async function isAwolRun(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    return /\bawol (scan|discover)\b/.test(stdout);
  } catch {
    // ps exits 1 when there is no such process.
    return false;
  }
}

// Runs a Discovery of `scope`, printing its progress and then how many
// services it found in how many regions, and, on a terminal, each of them
// with how many resources it has and where. With `force`, it first stops an
// `awol scan` or `awol discover` of the account that is running.
async function runDiscover(deps: CliDeps, scope: DiscoveryScope, force: boolean): Promise<number> {
  return reporting(deps, async (onProgress) => {
    const outcome = await forcing(deps, force, (takeOver) => deps.awol.discover({ scope, onProgress, startedBy: "awol discover", takeOver }));
    if (outcome.kind !== "discovered") return outcome;
    const found = outcome.discovery.services.filter(({ count }) => count > 0);
    const regions = new Set(found.flatMap(({ regions }) => regions.map(({ region }) => region)));
    const headline = `found ${counted(found.length, "service")} in ${counted(regions.size, "region")}`;
    return {
      summary: (look, stale) => {
        if (!look.fancy) return [stale === undefined ? headline : `${headline}, ${stale}`];
        const nameWidth = Math.max(...found.map(({ service }) => service.length));
        const countWidth = Math.max(...found.map(({ count }) => String(count).length));
        return [
          `${look.bold(`F${headline.slice(1)}`)}${stale === undefined ? "" : `  ${look.yellow(stale)}`}`,
          ...found.map(
            ({ service, count, regions }) =>
              `  ${service.padEnd(nameWidth)}  ${String(count).padStart(countWidth)}  ${look.dim(regions.map(({ region }) => region).join(", "))}`,
          ),
        ];
      },
      failed: outcome.discovery.failedParts.length,
    };
  });
}

// Runs a Scan, printing its progress and then how many Components have each
// Status, on a terminal one line each in its Status's color. Before any
// Monitored services are chosen, it asks on a terminal whether to scan every
// supported service, leaving them unchosen. With `force`, it first stops an
// `awol scan` or `awol discover` of the account that is running.
async function runScan(deps: CliDeps, force: boolean): Promise<number> {
  return reporting(deps, async (onProgress) => {
    const scan = (readEverySupportedService: boolean) =>
      forcing(deps, force, (takeOver) => deps.awol.scan({ onProgress, startedBy: "awol scan", readEverySupportedService, takeOver }));
    let outcome = await scan(false);
    if (outcome.kind === "monitored-services-needed" && deps.terminal.stdin && deps.terminal.stdout) {
      const answer = await deps.ask("No Monitored services chosen. Scan every supported service? [y/N] ");
      if (/^y(es)?$/i.test(answer.trim())) outcome = await scan(true);
    }
    if (outcome.kind !== "scanned") return outcome;
    const { counts, failedParts } = outcome.lastScan;
    return {
      summary: (look, stale) => {
        const line = STATUSES.map((status) => `${status} ${counts[status]}`).join(", ");
        if (!look.fancy) return [stale === undefined ? line : `${line}, ${stale}`];
        const colorOf: Record<Status, (text: string) => string> = {
          AWOL: look.red,
          "Falling behind": look.yellow,
          Current: look.green,
          Untracked: look.dim,
        };
        const labelWidth = Math.max(...STATUSES.map((status) => status.length));
        const countWidth = Math.max(...STATUSES.map((status) => String(counts[status]).length));
        return [
          ...STATUSES.map((status) => colorOf[status](`${status.padEnd(labelWidth)}  ${String(counts[status]).padStart(countWidth)}`)),
          ...(stale === undefined ? [] : [look.yellow(stale)]),
        ];
      },
      failed: failedParts.length,
    };
  });
}

// What `awol discover` or `awol scan` ended in, when it read: its summary,
// as lines that look like `look`, with `stale`, how many parts are Stale in
// words, if any are, and how many parts it could not read.
type Read = { summary: (look: Look, stale: string | undefined) => string[]; failed: number };

// Runs `operation`, printing its progress as it runs, then its summary and,
// when the server is running, where to see it. Exits 0 when every part was
// read, 3 when some are Stale, and 1 when it read nothing: credentials that
// need a login, another Scan or Discovery running, no Monitored services, or
// an error. Ctrl-C, or being stopped by another's --force, stops it,
// releasing the account's lock as awol exits.
async function reporting(
  deps: CliDeps,
  operation: (
    onProgress: (progress: Progress) => void,
  ) => Promise<Read | NotStopped | Exclude<ScanOutcome | DiscoveryOutcome, { kind: "scanned" | "discovered" }>>,
): Promise<number> {
  const look = lookOf(deps.terminal.stdout, deps.color);
  const printer = progressPrinter(deps);
  const exitOn = (code: number) => () => {
    printer.end();
    process.exit(code);
  };
  const interrupt = exitOn(130);
  const terminate = exitOn(143);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  let outcome: Awaited<ReturnType<typeof operation>>;
  try {
    outcome = await operation(printer.tell);
  } catch (error) {
    deps.stderr(`awol: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    printer.end();
  }
  if ("summary" in outcome) {
    const stale = outcome.failed === 0 ? undefined : `${counted(outcome.failed, "part")} Stale`;
    deps.stdout([...(look.fancy ? [""] : []), ...outcome.summary(look, stale), ""].join("\n"));
    await pointAtDashboard(deps, look);
    return outcome.failed > 0 ? 3 : 0;
  }
  if (outcome.kind === "login-needed") deps.stderr(`awol: ${outcome.reason}\n`);
  if (outcome.kind === "monitored-services-needed") deps.stderr("awol: choose Monitored services with awol monitor or in the dashboard first\n");
  if (outcome.kind === "busy") deps.stderr(`awol: ${alreadyRunning(outcome)}\n`);
  if (outcome.kind === "not-stopped") deps.stderr(`awol: ${nameOf(outcome.busy.running)} did not stop within ${deps.cancelTimeoutMs / 1000}s\n`);
  if (outcome.kind === "cancelled") deps.stderr("awol: cancelled on request\n");
  return 1;
}

// Prints where to see the dashboard, looking like `look`, when the server is
// running.
async function pointAtDashboard(deps: CliDeps, look: Look) {
  const live = await liveServer(openServerRecord(deps.dataDir));
  if (live !== undefined) deps.stdout(look.fancy ? `\nSee ${look.cyan(live.url)}\n` : `see ${live.url}\n`);
}

// `count` `thing`s, in words.
function counted(count: number, thing: string): string {
  return `${count} ${thing}${count === 1 ? "" : "s"}`;
}

// How output looks on one stream: plain lines, or, `fancy` on a terminal,
// ticks and a summary laid out, colored only when `color` is wanted too.
type Look = { fancy: boolean } & Record<"bold" | "dim" | "red" | "green" | "yellow" | "cyan", (text: string) => string>;

function lookOf(fancy: boolean, color: boolean): Look {
  // `text` between the ANSI codes that turn a style on and off.
  const style = (on: number, off: number) => (text: string) => (fancy && color ? `\x1b[${on}m${text}\x1b[${off}m` : text);
  return {
    fancy,
    bold: style(1, 22),
    dim: style(2, 22),
    red: style(31, 39),
    green: style(32, 39),
    yellow: style(33, 39),
    cyan: style(36, 39),
  };
}

// Clears the terminal's line and goes back to its start.
const CLEAR_LINE = "\r\x1b[K";

// Prints a Scan's or Discovery's steps on stdout as each is done, and each
// part that fails on stderr as it fails, each ticked or crossed on a
// terminal. When stderr is a terminal, a progress bar of the parts done
// stays under them until `end`.
function progressPrinter({ terminal, color, stdout, stderr }: CliDeps) {
  const out = lookOf(terminal.stdout, color);
  const err = lookOf(terminal.stderr, color);
  let bar: string | undefined;

  // Prints `text` with `print` above the bar.
  function above(print: (text: string) => void, text: string) {
    if (bar !== undefined) stderr(CLEAR_LINE);
    print(text);
    if (bar !== undefined) stderr(bar);
  }

  return {
    tell(progress: Progress) {
      if (progress.kind === "failed") {
        const line = `${err.bold(partName(progress.part))} failed: ${progress.error}`;
        above(stderr, `${err.fancy ? `${err.red("✖")} ` : ""}${line}\n`);
      } else if (progress.kind === "step-done") {
        const [subject, done] = stepName(progress.step);
        above(stdout, `${out.fancy ? `${out.green("✔")} ` : ""}${out.bold(subject)} ${done}\n`);
      } else if (terminal.stderr && progress.total > 0) {
        bar = barOf(progress.done, progress.total);
        stderr(`${CLEAR_LINE}${bar}`);
      }
    },

    end() {
      if (bar === undefined) return;
      stderr(CLEAR_LINE);
      bar = undefined;
    },
  };
}

// A bar of `done` parts of `total`.
function barOf(done: number, total: number): string {
  const width = 30;
  const filled = Math.floor((width * done) / total);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${done}/${total} parts`;
}

// The line printed once `step` is done: what it read, and what it did.
function stepName(step: Step): [string, string] {
  if (step.kind === "regions") return ["regions", "read"];
  if (step.kind === "counted") return [step.awsService, "counted"];
  if (step.kind === "versions") return [step.service, "versions read"];
  if (step.kind === "scanned") return [step.service, "done"];
  return ["endoflife.date", "done"];
}

// The name of a part, as its failure line starts.
function partName(part: Part): string {
  if (part.kind === "regions") return "regions";
  if (part.kind === "presence") return `${part.awsService} ${part.region}`;
  if (part.kind === "endoflife.date") return `endoflife.date ${part.product}`;
  if (part.kind === "tags") return `tags ${part.region}`;
  return `${part.service} ${part.region}`;
}

// Chooses the account's Monitored services on a checklist of every
// supported service, in alphabetical order, each with how many resources the
// last Discovery found, the current choice ticked, and keeps the ticked ones
// on enter, printing each ticked under a Monitoring heading.
async function runMonitor(deps: CliDeps): Promise<number> {
  if (!deps.terminal.stdin || !deps.terminal.stdout) {
    deps.stderr("awol: awol monitor needs a terminal; choose Monitored services in the dashboard\n");
    return 1;
  }
  const model = await deps.awol.pageModel();
  if (model.kind === "login-needed") {
    deps.stderr(`awol: ${model.reason}\n`);
    return 1;
  }
  if (model.discovery === undefined) {
    deps.stderr("awol: run awol discover first\n");
    return 1;
  }
  const { services } = model.discovery;
  const rows = SUPPORTED_SERVICES.toSorted((a, b) => a.localeCompare(b)).map((service) => ({
    service,
    count: services.find((row) => row.service === service)?.count ?? 0,
  }));
  const monitored = model.monitoredServices ?? [];
  const ticked = new Set<SupportedService>(monitored);
  let cursor = 0;
  // Whether to say to choose at least one service: enter was pressed with
  // nothing ticked, and nothing has been ticked since.
  let showChooseOne = false;
  const look = lookOf(true, deps.color);
  const nameWidth = Math.max(...rows.map(({ service }) => service.length));
  const countWidth = Math.max(...rows.map(({ count }) => String(count).length));
  const checklist = () => [
    "Choose Monitored services:",
    ...rows.map(({ service, count }, at) => {
      const resources = `${String(count).padStart(countWidth)} resource${count === 1 ? "" : "s"}`;
      const line = `${at === cursor ? ">" : " "} [${ticked.has(service) ? "x" : " "}] ${service.padEnd(nameWidth)}  ${look.dim(resources)}`;
      return at === cursor ? look.cyan(line) : line;
    }),
    ...(showChooseOne ? ["Choose at least one service"] : []),
    "↑/↓ move · space toggle · enter save · esc quit",
  ];
  const screen = redrawable(deps.stdout);
  screen.draw(checklist());
  for await (const key of deps.keys()) {
    if (key === "escape" || key === "q") break;
    if (key === "ctrl-c") {
      screen.erase();
      return 130;
    }
    if (key === "up") cursor = Math.max(cursor - 1, 0);
    if (key === "down") cursor = Math.min(cursor + 1, rows.length - 1);
    if (key === "space") {
      const { service } = rows[cursor]!;
      if (!ticked.delete(service)) ticked.add(service);
      if (ticked.size > 0) showChooseOne = false;
    }
    if (key === "enter" && ticked.size === 0) showChooseOne = true;
    if (key === "enter" && ticked.size > 0) {
      screen.erase();
      const changed = ticked.size !== monitored.length || monitored.some((service) => !ticked.has(service));
      const saved = changed ? await deps.awol.setMonitoredServices([...ticked]) : undefined;
      if (saved?.kind === "login-needed") {
        deps.stderr(`awol: ${saved.reason}\n`);
        return 1;
      }
      const chosen = rows.flatMap(({ service }) => (ticked.has(service) ? [`  ${look.green("✔")} ${service}\n`] : []));
      deps.stdout(`${look.bold("Monitoring")}\n${chosen.join("")}`);
      await pointAtDashboard(deps, look);
      return 0;
    }
    screen.draw(checklist());
  }
  screen.erase();
  deps.stderr("awol: nothing saved\n");
  return 1;
}

// Lines drawn on a terminal with `print`, each drawing over the last.
function redrawable(print: (text: string) => void) {
  let drawn = 0;
  // Goes back up over the lines drawn, clearing them.
  const back = () => (drawn === 0 ? "" : `\x1b[${drawn}A\r\x1b[J`);
  return {
    draw(lines: string[]) {
      print(`${back()}${lines.map((line) => `${line}\n`).join("")}`);
      drawn = lines.length;
    },

    erase() {
      print(back());
      drawn = 0;
    },
  };
}

async function runStart(deps: CliDeps): Promise<number> {
  const record = openServerRecord(deps.dataDir);
  const live = await liveServer(record);
  if (live !== undefined) {
    deps.stdout(`awol running at ${live.url}\n`);
    deps.openBrowser(live.url);
    return 0;
  }

  // Otherwise the new server would fail to listen while `url` still answered.
  if (await isAnswering(deps.url)) {
    deps.stderr(`awol: ${deps.url} is already in use\n`);
    return 1;
  }
  const server = await spawnServer(deps);
  const outcome = await waitUntilAnswering(deps, server);
  if (outcome === "exited") {
    deps.stderr(`awol: the server exited before it answered; see ${serverLog(deps.dataDir)}\n`);
    return 1;
  }
  if (outcome === "timed out") {
    await stopProcess(server.pid!, deps.stopTimeoutMs, { group: true });
    deps.stderr(
      `awol: the server did not answer on ${deps.url} within ${deps.startTimeoutMs / 1000} seconds; see ${serverLog(deps.dataDir)}\n`,
    );
    return 1;
  }
  await record.save({ pid: server.pid!, url: deps.url });
  deps.stdout(`awol running at ${deps.url}\n`);
  deps.openBrowser(deps.url);
  return 0;
}

async function runStop(deps: CliDeps): Promise<number> {
  const record = openServerRecord(deps.dataDir);
  const live = await liveServer(record);
  const stopped = live !== undefined && (await stopProcess(live.pid, deps.stopTimeoutMs, { group: true }));
  await record.clear();
  deps.stdout(stopped ? "awol stopped\n" : "awol is not running\n");
  return 0;
}

// The recorded server, when its process is there and its URL answers. A pid
// alone is not enough: once the server is gone, the system can give its pid to
// another process.
async function liveServer(record: ServerRecordFile): Promise<ServerRecord | undefined> {
  const recorded = await record.load();
  if (recorded === undefined || !isAlive(recorded.pid)) return undefined;
  return (await isAnswering(recorded.url)) ? recorded : undefined;
}

// Asks the process `pid`, or with `group` its whole process group, as the
// server's, to stop, kills it if it is still there after timeoutMs, and
// waits until it is gone. Gives false when there is no such process.
async function stopProcess(pid: number, timeoutMs: number, { group = false } = {}): Promise<boolean> {
  const target = group ? -pid : pid;
  if (!signal(target, "SIGTERM")) return false;
  const deadline = Date.now() + timeoutMs;
  let killed = false;
  while (isAlive(pid)) {
    if (!killed && Date.now() > deadline) {
      signal(target, "SIGKILL");
      killed = true;
    }
    await sleep(100);
  }
  return true;
}

// Sends `name` to `target`: a pid, or a process group as its negative.
// Gives false when there is no such process.
function signal(target: number, name: NodeJS.Signals): boolean {
  try {
    process.kill(target, name);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Starts the server in its own process group, detached from this one, with
// its output going to server.log in the data directory.
async function spawnServer({ dataDir, server }: CliDeps): Promise<ChildProcess> {
  await mkdir(dataDir, { recursive: true });
  const log = await open(serverLog(dataDir), "a");
  try {
    const child = spawn(server.command, server.args, {
      cwd: server.cwd,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.unref();
    return child;
  } finally {
    await log.close();
  }
}

function serverLog(dataDir: string): string {
  return path.join(dataDir, "server.log");
}

// Waits until `url` answers, the server exits, or startTimeoutMs passes. The
// server sits in its own process group, so Ctrl-C does not reach it: it is
// stopped here instead of being left running with no record.
async function waitUntilAnswering(
  { url, startTimeoutMs }: CliDeps,
  server: ChildProcess,
): Promise<"answering" | "exited" | "timed out"> {
  const interrupt = () => {
    signal(-server.pid!, "SIGTERM");
    process.exit(130);
  };
  process.once("SIGINT", interrupt);
  try {
    const deadline = Date.now() + startTimeoutMs;
    while (server.exitCode === null && server.signalCode === null) {
      if (await isAnswering(url)) return "answering";
      if (Date.now() > deadline) return "timed out";
      await sleep(100);
    }
    return "exited";
  } finally {
    process.off("SIGINT", interrupt);
  }
}

async function isAnswering(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}
