import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAwol } from "../awol/awol.ts";
import awsLambda from "../awol/fixtures/endoflife/aws-lambda.json" with { type: "json" };
import { type AwsRunner, awsCliError } from "../aws/runner.ts";
import type { ServerRecord } from "../data/server-record.ts";
import type { EndOfLifeFetcher } from "../endoflife/fetcher.ts";
import { type Key, runCli } from "./run.ts";

// Stands in for the Next.js server: answers every request on the port it is
// given, on 127.0.0.1.
const TINY_SERVER = `
require("node:http")
  .createServer((req, res) => res.end("ok"))
  .listen(Number(process.argv[1]), "127.0.0.1");
`;

let dir: string;
let url: string;
let port: number;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "awol-cli-"));
  port = await freePort();
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  const record = await serverRecord();
  if (record !== undefined && isAlive(record.pid)) process.kill(record.pid, "SIGKILL");
  await rm(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function dataDir() {
  return path.join(dir, "data");
}

const NOW = new Date("2026-11-03T12:00:00Z");

// The CLI prints times in the local time zone; tests read them in UTC.
process.env.TZ = "UTC";

const NO_TERMINAL = { stdin: false, stdout: false, stderr: false };

// awol on the data directory, reading AWS with `aws`.
function awolWith(aws: AwsRunner) {
  return openAwol({ aws, endOfLife: fakeEndOfLife, dataDir: dataDir(), clock: { now: () => NOW } });
}

async function cli(
  argv: string[],
  {
    serverArgs = ["-e", TINY_SERVER, String(port)],
    startTimeoutMs = 10_000,
    stopTimeoutMs = 10_000,
    aws = fakeAws(),
    cancelTimeoutMs = 5_000,
    width = 200,
    terminal = NO_TERMINAL,
    color = false,
    answer = "",
    asked = [],
    pressed = [],
    screens = [],
    keyboard = { closed: false },
  }: {
    serverArgs?: string[];
    startTimeoutMs?: number;
    stopTimeoutMs?: number;
    cancelTimeoutMs?: number;
    width?: number;
    aws?: AwsRunner;
    terminal?: { stdin: boolean; stdout: boolean; stderr: boolean };
    color?: boolean;
    answer?: string;
    asked?: string[];
    // The keys pressed on the terminal, in order, and where to keep what
    // was on stdout's screen as each was about to be pressed.
    pressed?: Key[];
    screens?: string[][];
    // Whether no more keys were wanted, as the terminal leaves raw mode
    // then.
    keyboard?: { closed: boolean };
  } = {},
) {
  let stdout = "";
  let stderr = "";
  const opened: string[] = [];
  const code = await runCli(argv, {
    dataDir: dataDir(),
    url,
    server: { command: process.execPath, args: serverArgs, cwd: dir },
    startTimeoutMs,
    stopTimeoutMs,
    cancelTimeoutMs,
    openBrowser: (target) => void opened.push(target),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    awol: awolWith(aws),
    terminal,
    width: () => width,
    color,
    ask: async (question) => {
      asked.push(question);
      return answer;
    },
    keys: async function* () {
      try {
        for (const key of pressed) {
          screens.push(screenOf(stdout));
          yield key;
        }
      } finally {
        keyboard.closed = true;
      }
    },
  });
  return { code, stdout, stderr, opened };
}

// What `output` leaves on a terminal's screen, line by line, without its
// colors: text drawn, lines ended, the cursor moved up, back to the start of
// its line, and everything from it on cleared.
function screenOf(output: string): string[] {
  const lines: string[] = [];
  let row = 0;
  for (const token of output.replaceAll(/\x1b\[\d+m/g, "").split(/(\n|\r|\x1b\[\d+A|\x1b\[J)/)) {
    if (token === "\n") lines[row++] ??= "";
    else if (token === "\r") continue;
    else if (token === "\x1b[J") lines.splice(row);
    else if (token.startsWith("\x1b[")) row -= Number(token.slice(2, -1));
    else if (token !== "") lines[row] = (lines[row] ?? "") + token;
  }
  return lines;
}

const CALLER_IDENTITY = "sts get-caller-identity --output json";

const THROTTLED = "\nAn error occurred (ThrottlingException) when calling the ListClusters operation (reached max retries: 2): Rate exceeded\n";

const EXPIRED = "\nAn error occurred (ExpiredToken) when calling the GetCallerIdentity operation: The security token included in the request is expired\n";

// An account with one enabled region, eu-west-1, and nothing in it but the
// Lambda function function-6 on python3.12, with no aliases. `changes`
// replaces the answer to a call, a JSON body or the stderr of a failure.
function fakeAws(changes: Record<string, unknown | { stderr: string }> = {}): AwsRunner & { calls: string[] } {
  const region = (call: string) => `${call} --region eu-west-1 --output json`;
  const answers: Record<string, unknown> = {
    [CALLER_IDENTITY]: { Account: "123456789012" },
    "account list-regions --output json": { Regions: [{ RegionName: "eu-west-1", RegionOptStatus: "ENABLED_BY_DEFAULT" }] },
    [region("rds describe-db-instances")]: { DBInstances: [] },
    [region("rds describe-db-clusters")]: { DBClusters: [] },
    [region("elasticache describe-replication-groups")]: { ReplicationGroups: [] },
    [region("elasticache describe-cache-clusters")]: { CacheClusters: [] },
    [region("elasticache describe-serverless-caches")]: { ServerlessCaches: [] },
    [region("opensearch list-domain-names")]: { DomainNames: [] },
    [region("lambda list-functions")]: {
      Functions: [{ FunctionName: "function-6", Runtime: "python3.12", PackageType: "Zip", Version: "$LATEST" }],
    },
    "lambda list-aliases --region eu-west-1 --function-name function-6 --output json": { Aliases: [] },
    [region("eks list-clusters")]: { clusters: [] },
    [region("kafka list-clusters-v2")]: { ClusterInfoList: [] },
    [region("mq list-brokers")]: { BrokerSummaries: [] },
    [region("memorydb describe-clusters")]: { Clusters: [] },
    "elasticbeanstalk describe-environments --region eu-west-1 --no-include-deleted --output json": { Environments: [] },
    [region("ec2 describe-instances")]: { Reservations: [] },
    ...changes,
  };
  const calls: string[] = [];
  return Object.assign(
    async (argv: string[]) => {
      const call = argv.join(" ");
      calls.push(call);
      const answer = answers[call];
      if (answer === undefined) throw new Error(`no answer for \`aws ${call}\``);
      if (typeof answer === "object" && answer !== null && "stderr" in answer) throw awsCliError(argv, (answer as { stderr: string }).stderr);
      return JSON.stringify(answer);
    },
    { calls },
  );
}

// Replays endoflife.date's recorded AWS Lambda runtimes.
const fakeEndOfLife: EndOfLifeFetcher = async (target) => {
  if (target !== "https://endoflife.date/api/v1/products/aws-lambda") throw new Error(`unexpected endoflife.date fetch of ${target}`);
  return { status: 200, etag: '"lambda"', body: JSON.stringify(awsLambda) };
};

const USAGE = "usage: awol start | awol stop | awol discover [--failed] [--force] | awol scan [--force] | awol monitor";

// Writes the lock of a Scan of the account held by `pid`, started by
// `startedBy`.
async function writeRunning(pid: number, startedBy = "the dashboard") {
  await mkdir(path.join(dataDir(), "accounts", "123456789012"), { recursive: true });
  await writeFile(
    path.join(dataDir(), "accounts", "123456789012", "running.json"),
    JSON.stringify({ operation: "Scan", startedBy, startedAt: "2026-11-03T11:58:00.000Z", pid }),
  );
}

// The progress bars drawn on stderr, each as how many parts were done of
// how many.
function barsOf(stderr: string) {
  return stderr.split("\r\x1b[K").flatMap((frame) => {
    const match = frame.match(/^\[[#-]{30}\] (\d+)\/(\d+) parts$/);
    return match === null ? [] : [{ done: Number(match[1]), total: Number(match[2]) }];
  });
}

async function serverRecord(): Promise<ServerRecord | undefined> {
  try {
    return JSON.parse(await readFile(path.join(dataDir(), "server.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function writeServerRecord(record: ServerRecord) {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(path.join(dataDir(), "server.json"), JSON.stringify(record));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isAnswering(target: string): Promise<boolean> {
  try {
    await fetch(target);
    return true;
  } catch {
    return false;
  }
}

// A live process that is not an awol server, standing in for one that was
// given the recorded server's pid after it exited, or, given `args`, one
// whose command line ends in them, such as `awol scan`.
async function withUnrelatedProcess(test: (pid: number) => Promise<void>, args: string[] = []) {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...args], {
    stdio: "ignore",
  });
  try {
    await test(unrelated.pid!);
  } finally {
    unrelated.kill("SIGKILL");
  }
}

describe("awol start", () => {
  it("starts the server in the background, records it, prints the URL, and opens the browser", async () => {
    const result = await cli(["start"]);

    expect(result).toEqual({
      code: 0,
      stdout: `awol running at ${url}\n`,
      stderr: "",
      opened: [url],
    });
    const record = await serverRecord();
    expect(record).toEqual({ pid: expect.any(Number), url });
    expect(isAlive(record!.pid)).toBe(true);
    expect(await isAnswering(url)).toBe(true);
  });

  it("only opens the browser when the recorded server is running", async () => {
    await cli(["start"]);
    const first = await serverRecord();

    const result = await cli(["start"]);

    expect(result).toEqual({
      code: 0,
      stdout: `awol running at ${url}\n`,
      stderr: "",
      opened: [url],
    });
    expect(await serverRecord()).toEqual(first);
    expect(isAlive(first!.pid)).toBe(true);
  });

  it("starts a new server when the recorded one is gone", async () => {
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeServerRecord({ pid: gone, url });

    const result = await cli(["start"]);

    expect(result).toEqual({
      code: 0,
      stdout: `awol running at ${url}\n`,
      stderr: "",
      opened: [url],
    });
    const record = await serverRecord();
    expect(record).toEqual({ pid: expect.any(Number), url });
    expect(record!.pid).not.toBe(gone);
    expect(isAlive(record!.pid)).toBe(true);
    expect(await isAnswering(url)).toBe(true);
  });

  it("starts a new server when the recorded pid now belongs to another process", async () => {
    await withUnrelatedProcess(async (unrelated) => {
      await writeServerRecord({ pid: unrelated, url });

      const result = await cli(["start"]);

      expect(result).toEqual({
        code: 0,
        stdout: `awol running at ${url}\n`,
        stderr: "",
        opened: [url],
      });
      const record = await serverRecord();
      expect(record!.pid).not.toBe(unrelated);
      expect(await isAnswering(url)).toBe(true);
      expect(isAlive(unrelated)).toBe(true);
    });
  });

  it("fails, recording nothing and stopping the server, when it does not answer in time", async () => {
    const pidFile = path.join(dir, "silent.pid");
    const silent = `
      require("node:fs").writeFileSync(process.argv[1], String(process.pid));
      setInterval(() => {}, 1000);
    `;

    const result = await cli(["start"], { serverArgs: ["-e", silent, pidFile], startTimeoutMs: 500 });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `awol: the server did not answer on ${url} within 0.5 seconds; see ${path.join(dataDir(), "server.log")}\n`,
      opened: [],
    });
    expect(await serverRecord()).toBeUndefined();
    expect(isAlive(Number(await readFile(pidFile, "utf8")))).toBe(false);
  });

  it("fails, recording nothing, when the server exits before it answers", async () => {
    const result = await cli(["start"], { serverArgs: ["-e", "process.exit(1)"] });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `awol: the server exited before it answered; see ${path.join(dataDir(), "server.log")}\n`,
      opened: [],
    });
    expect(await serverRecord()).toBeUndefined();
  });

  it("fails, recording nothing, when something else already answers on the URL", async () => {
    const other = createHttpServer((req, res) => res.end("other"));
    await new Promise<void>((resolve) => other.listen(port, "127.0.0.1", resolve));
    try {
      const result = await cli(["start"]);

      expect(result).toEqual({
        code: 1,
        stdout: "",
        stderr: `awol: ${url} is already in use\n`,
        opened: [],
      });
      expect(await serverRecord()).toBeUndefined();
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
  });
});

describe("awol stop", () => {
  it("stops the recorded server and clears the record", async () => {
    await cli(["start"]);
    const { pid } = (await serverRecord())!;

    const result = await cli(["stop"]);

    expect(result).toEqual({ code: 0, stdout: "awol stopped\n", stderr: "", opened: [] });
    expect(isAlive(pid)).toBe(false);
    expect(await isAnswering(url)).toBe(false);
    expect(await serverRecord()).toBeUndefined();
  });

  it("kills the recorded server when it does not stop in time", async () => {
    const stubborn = `
      process.on("SIGTERM", () => {});
      require("node:http")
        .createServer((req, res) => res.end("ok"))
        .listen(Number(process.argv[1]), "127.0.0.1");
    `;
    await cli(["start"], { serverArgs: ["-e", stubborn, String(port)] });
    const { pid } = (await serverRecord())!;
    try {
      const result = await cli(["stop"], { stopTimeoutMs: 500 });

      expect(result).toEqual({ code: 0, stdout: "awol stopped\n", stderr: "", opened: [] });
      expect(isAlive(pid)).toBe(false);
      expect(await isAnswering(url)).toBe(false);
      expect(await serverRecord()).toBeUndefined();
    } finally {
      if (isAlive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("says so when no server was started", async () => {
    const result = await cli(["stop"]);

    expect(result).toEqual({ code: 0, stdout: "awol is not running\n", stderr: "", opened: [] });
  });

  it("says so and clears the record when the recorded server is gone", async () => {
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeServerRecord({ pid: gone, url });

    const result = await cli(["stop"]);

    expect(result).toEqual({ code: 0, stdout: "awol is not running\n", stderr: "", opened: [] });
    expect(await serverRecord()).toBeUndefined();
  });

  it("says so, leaving it running, when the recorded pid now belongs to another process", async () => {
    await withUnrelatedProcess(async (unrelated) => {
      await writeServerRecord({ pid: unrelated, url });

      const result = await cli(["stop"]);

      expect(result).toEqual({ code: 0, stdout: "awol is not running\n", stderr: "", opened: [] });
      expect(await serverRecord()).toBeUndefined();
      expect(isAlive(unrelated)).toBe(true);
    });
  });
});

const DISCOVERY_STEPS = [
  "regions read",
  "RDS counted",
  "ElastiCache counted",
  "OpenSearch counted",
  "Lambda counted",
  "EKS counted",
  "MSK counted",
  "Amazon MQ counted",
  "MemoryDB counted",
  "Elastic Beanstalk counted",
  "EC2 counted",
  "Lambda versions read",
];

describe("awol discover", () => {
  it("runs a Discovery, printing each step once it is done in every region, then what it found", async () => {
    const result = await cli(["discover"]);

    expect(result).toEqual({
      code: 0,
      stdout: [...DISCOVERY_STEPS, "found 1 service in 1 region", ""].join("\n"),
      stderr: "",
      opened: [],
    });
    const model = await awolWith(fakeAws()).pageModel();
    expect(model.kind === "signed-in" && model.discovery?.finishedAt).toBe("2026-11-03T12:00:00.000Z");
  });

  it("prints a part that fails as it fails, counts it as Stale, and exits 3", async () => {
    const result = await cli(["discover"], { aws: fakeAws({ "eks list-clusters --region eu-west-1 --output json": { stderr: THROTTLED } }) });

    expect(result).toEqual({
      code: 3,
      stdout: [...DISCOVERY_STEPS, "found 1 service in 1 region, 1 part Stale", ""].join("\n"),
      stderr: `EKS eu-west-1 failed: ${THROTTLED.trim()}\n`,
      opened: [],
    });
  });

  it("re-reads only the parts the last Discovery could not read, with --failed", async () => {
    await cli(["discover"], { aws: fakeAws({ "eks list-clusters --region eu-west-1 --output json": { stderr: THROTTLED } }) });
    const aws = fakeAws();

    const result = await cli(["discover", "--failed"], { aws });

    expect(result).toEqual({ code: 0, stdout: [...DISCOVERY_STEPS, "found 1 service in 1 region", ""].join("\n"), stderr: "", opened: [] });
    expect(aws.calls).toEqual([CALLER_IDENTITY, "eks list-clusters --region eu-west-1 --output json"]);
  });

  it("draws a progress bar of the parts done on a terminal, its total growing as parts become known, and clears it", async () => {
    const result = await cli(["discover"], { terminal: { stdin: false, stdout: false, stderr: true } });

    const bars = barsOf(result.stderr);
    expect(bars[0]).toEqual({ done: 0, total: 1 });
    expect(bars.at(-1)).toEqual({ done: 12, total: 12 });
    expect(bars.map(({ total }) => total)).toEqual(bars.map(({ total }) => total).sort((a, b) => a - b));
    expect(result.stderr.endsWith("\r\x1b[K")).toBe(true);
    expect(result.code).toBe(0);
  });

  it("points at the dashboard when the server is running", async () => {
    await cli(["start"]);

    const result = await cli(["discover"]);

    expect(result.stdout.split("\n").slice(-3)).toEqual(["found 1 service in 1 region", `see ${url}`, ""]);
    expect(result.code).toBe(0);
  });

  it("asks to log in again when credentials have expired, and exits 1", async () => {
    const result = await cli(["discover"], { aws: fakeAws({ [CALLER_IDENTITY]: { stderr: EXPIRED } }) });

    expect(result).toEqual({ code: 1, stdout: "", stderr: `awol: ${EXPIRED.trim()}\n`, opened: [] });
  });

  it("refuses to run while a Scan or Discovery of the account runs, and exits 1", async () => {
    await withUnrelatedProcess(async (pid) => {
      await writeRunning(pid);
      const aws = fakeAws();

      const result = await cli(["discover"], { aws });

      expect(result).toEqual({
        code: 1,
        stdout: "",
        stderr: "awol: a Scan is already running (started 11:58 from the dashboard); use --force to stop it\n",
        opened: [],
      });
      expect(aws.calls).toEqual([CALLER_IDENTITY]);
    });
  });

  it("prints the usage for an unknown option, and exits 2", async () => {
    const result = await cli(["discover", "--everything"]);

    expect(result).toEqual({ code: 2, stdout: "", stderr: `${USAGE}\n`, opened: [] });
  });

  it("ticks each step on a terminal, then ends with what it found, service by service, aligned", async () => {
    const aws = fakeAws({ "eks list-clusters --region eu-west-1 --output json": { clusters: ["cluster-1", "cluster-2"] } });

    const result = await cli(["discover"], { aws, terminal: { stdin: false, stdout: true, stderr: false } });

    expect(result).toEqual({
      code: 0,
      stdout: [
        ...DISCOVERY_STEPS.map((step) => `✔ ${step}`),
        "",
        "Found 2 services in 1 region",
        "  Lambda  1  eu-west-1",
        "  EKS     2  eu-west-1",
        "",
      ].join("\n"),
      stderr: "",
      opened: [],
    });
  });

  it("crosses a part that fails on a terminal, and counts it as Stale after what it found", async () => {
    const aws = fakeAws({ "eks list-clusters --region eu-west-1 --output json": { stderr: THROTTLED } });

    const result = await cli(["discover"], { aws, terminal: { stdin: false, stdout: true, stderr: true } });

    const withoutBars = result.stderr.replaceAll("\r\x1b[K", "").replaceAll(/\[[#-]{30}\] \d+\/\d+ parts/g, "");
    expect(withoutBars).toBe(`✖ EKS eu-west-1 failed: ${THROTTLED.trim()}\n`);
    expect(result.stdout.split("\n").slice(-4)).toEqual(["", "Found 1 service in 1 region  1 part Stale", "  Lambda  1  eu-west-1", ""]);
    expect(result.code).toBe(3);
  });

  it("colors its output on a terminal unless told not to, as by NO_COLOR", async () => {
    const terminal = { stdin: false, stdout: true, stderr: false };

    const colored = await cli(["discover"], { terminal, color: true });
    const plain = await cli(["discover"], { terminal, color: false });

    expect(colored.stdout).toContain("\x1b[32m✔\x1b[39m \x1b[1mregions\x1b[22m read\n");
    expect(colored.stdout).toContain("\x1b[1mFound 1 service in 1 region\x1b[22m\n");
    expect(plain.stdout).not.toContain("\x1b[");
  });

  it("points at the dashboard on a terminal when the server is running", async () => {
    await cli(["start"]);

    const result = await cli(["discover"], { terminal: { stdin: false, stdout: true, stderr: false } });

    expect(result.stdout.split("\n").slice(-4)).toEqual(["  Lambda  1  eu-west-1", "", `See ${url}`, ""]);
  });
});

describe("awol scan", () => {
  const ON_A_TERMINAL = { stdin: true, stdout: true, stderr: false };

  // The account with Lambda as its one Monitored service.
  async function monitoringLambda() {
    expect(await awolWith(fakeAws()).setMonitoredServices(["Lambda"])).toEqual({ kind: "saved" });
  }

  it("runs a Scan of the Monitored services, printing each step once it is done in every region, then the count of each Status", async () => {
    await monitoringLambda();

    const result = await cli(["scan"]);

    expect(result).toEqual({
      code: 0,
      stdout: ["regions read", "Lambda done", "endoflife.date done", "AWOL 0, Falling behind 0, Current 1, Untracked 0", ""].join("\n"),
      stderr: "",
      opened: [],
    });
    const model = await awolWith(fakeAws()).pageModel();
    expect(model.kind === "signed-in" && model.lastScan?.ranAt).toBe("2026-11-03T12:00:00.000Z");
  });

  it("prints a part that fails as it fails, counts it as Stale, and exits 3", async () => {
    await monitoringLambda();

    const result = await cli(["scan"], { aws: fakeAws({ "opensearch list-domain-names --region eu-west-1 --output json": { stderr: THROTTLED } }) });

    expect(result).toEqual({
      code: 3,
      stdout: ["regions read", "Lambda done", "endoflife.date done", "AWOL 0, Falling behind 0, Current 1, Untracked 0, 1 part Stale", ""].join("\n"),
      stderr: `OpenSearch eu-west-1 failed: ${THROTTLED.trim()}\n`,
      opened: [],
    });
  });

  it("ends on a terminal with one line per Status, each in its color, and the Stale count on its own", async () => {
    await monitoringLambda();
    const aws = fakeAws({ "opensearch list-domain-names --region eu-west-1 --output json": { stderr: THROTTLED } });

    const result = await cli(["scan"], { aws, terminal: { stdin: false, stdout: true, stderr: false }, color: true });

    expect(result.stdout.split("\n").slice(-7)).toEqual([
      "",
      "\x1b[31mAWOL            0\x1b[39m",
      "\x1b[33mFalling behind  0\x1b[39m",
      "\x1b[32mCurrent         1\x1b[39m",
      "\x1b[2mUntracked       0\x1b[22m",
      "\x1b[33m1 part Stale\x1b[39m",
      "",
    ]);
    expect(result.code).toBe(3);
  });

  it("asks on a terminal, before any Monitored services are chosen, and scans every supported service on yes, leaving them unchosen", async () => {
    const asked: string[] = [];

    const result = await cli(["scan"], { terminal: ON_A_TERMINAL, answer: "y", asked });

    expect(asked).toEqual(["No Monitored services chosen. Scan every supported service? [y/N] "]);
    expect(result).toEqual({
      code: 0,
      stdout: [
        "✔ regions read",
        "✔ RDS done",
        "✔ ElastiCache done",
        "✔ OpenSearch done",
        "✔ Lambda done",
        "✔ endoflife.date done",
        "",
        "AWOL            0",
        "Falling behind  0",
        "Current         1",
        "Untracked       0",
        "",
      ].join("\n"),
      stderr: "",
      opened: [],
    });
    const model = await awolWith(fakeAws()).pageModel();
    expect(model.kind === "signed-in" && model.monitoredServices).toBeUndefined();
  });

  it.each([
    ["no", "n"],
    ["nothing", ""],
  ])("reads nothing on %s as the answer, and exits 1", async (_, answer) => {
    const aws = fakeAws();

    const result = await cli(["scan"], { aws, terminal: ON_A_TERMINAL, answer });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "awol: choose Monitored services with awol monitor or in the dashboard first\n",
      opened: [],
    });
    expect(aws.calls).toEqual([CALLER_IDENTITY]);
  });

  it("does not ask, and reads nothing, when not on a terminal before any Monitored services are chosen", async () => {
    const aws = fakeAws();
    const asked: string[] = [];

    const result = await cli(["scan"], { aws, terminal: { stdin: false, stdout: true, stderr: true }, answer: "y", asked });

    expect(asked).toEqual([]);
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "awol: choose Monitored services with awol monitor or in the dashboard first\n",
      opened: [],
    });
    expect(aws.calls).toEqual([CALLER_IDENTITY]);
  });

  it("asks to log in again when credentials have expired, and exits 1", async () => {
    await monitoringLambda();

    const result = await cli(["scan"], { aws: fakeAws({ [CALLER_IDENTITY]: { stderr: EXPIRED } }) });

    expect(result).toEqual({ code: 1, stdout: "", stderr: `awol: ${EXPIRED.trim()}\n`, opened: [] });
  });

  it("refuses to run while a Scan or Discovery of the account runs, and exits 1", async () => {
    await monitoringLambda();
    await withUnrelatedProcess(async (pid) => {
      await writeRunning(pid);

      const result = await cli(["scan"]);

      expect(result).toEqual({
        code: 1,
        stdout: "",
        stderr: "awol: a Scan is already running (started 11:58 from the dashboard); use --force to stop it\n",
        opened: [],
      });
    });
  });

  it("prints an error that is not AWS's, and exits 1, leaving the next Scan free to run", async () => {
    await monitoringLambda();

    const result = await cli(["scan"], { aws: fakeAws({ "account list-regions --output json": "not the regions" }) });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^awol: \S/);
    expect((await cli(["scan"])).code).toBe(0);
  });
});

describe("--force", () => {
  it("stops a Scan started in the terminal, then runs the Discovery", async () => {
    await withUnrelatedProcess(
      async (pid) => {
        await writeRunning(pid, "awol scan");

        const result = await cli(["discover", "--force"]);

        expect(result.stdout).toBe(
          ["Stopped the Scan in another terminal", ...DISCOVERY_STEPS, "found 1 service in 1 region", ""].join("\n"),
        );
        expect(result.code).toBe(0);
        expect(isAlive(pid)).toBe(false);
      },
      ["awol", "scan"],
    );
  });

  it("stops a Discovery started in the terminal, then runs the Scan, with --failed or not, in any order", async () => {
    expect(await awolWith(fakeAws()).setMonitoredServices(["Lambda"])).toEqual({ kind: "saved" });
    await withUnrelatedProcess(
      async (pid) => {
        await writeRunning(pid, "awol discover");

        expect((await cli(["scan", "--force"])).code).toBe(0);
        expect(isAlive(pid)).toBe(false);
      },
      ["awol", "discover"],
    );
    expect((await cli(["discover", "--force", "--failed"])).code).toBe(0);
  });

  // A Scan started from the dashboard, as the server runs one, held at its
  // first call for the account's regions until `release` is called.
  async function serverScan() {
    expect(await awolWith(fakeAws()).setMonitoredServices(["Lambda"])).toEqual({ kind: "saved" });
    const aws = fakeAws();
    let release!: () => void;
    let reach!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const scanning = awolWith(async (argv) => {
      if (argv[0] === "account") {
        reach();
        await gate;
      }
      return aws(argv);
    }).scan();
    await reached;
    return { scanning, release };
  }

  // Settles once the account has a request to cancel its Scan or Discovery.
  async function cancelRequested() {
    const accountDir = path.join(dataDir(), "accounts", "123456789012");
    while (!(await readdir(accountDir)).includes("cancel.json")) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it("cancels a Scan or Discovery that runs inside the server, leaving the server running, then runs", async () => {
    const { scanning, release } = await serverScan();

    const forcing = cli(["discover", "--force"]);
    await cancelRequested();
    release();
    const result = await forcing;

    expect(await scanning).toEqual({ kind: "cancelled" });
    expect(result).toEqual({
      code: 0,
      stdout: [
        "Cancelled the dashboard's Scan",
        ...DISCOVERY_STEPS,
        "found 1 service in 1 region",
        "",
      ].join("\n"),
      stderr: "",
      opened: [],
    });
  });

  it("spins on a terminal while it waits for the server's Scan or Discovery to stop, then clears it and ticks it", async () => {
    const { scanning, release } = await serverScan();

    const forcing = cli(["discover", "--force"], { terminal: { stdin: false, stdout: true, stderr: true } });
    await cancelRequested();
    release();
    const result = await forcing;

    await scanning;
    const waiting = "Cancelling the dashboard's Scan…";
    expect(result.stderr.startsWith(`\r\x1b[K⠋ ${waiting}`)).toBe(true);
    expect(result.stderr.indexOf("\r\x1b[K[")).toBeGreaterThan(result.stderr.lastIndexOf(waiting));
    expect(result.stdout.split("\n")[0]).toBe("✔ Cancelled the dashboard's Scan");
    expect(result.code).toBe(0);
  });

  it("cuts the spinner's line to the terminal's width, so it never wraps onto more lines", async () => {
    const { scanning, release } = await serverScan();

    const forcing = cli(["discover", "--force"], { terminal: { stdin: false, stdout: false, stderr: true }, width: 20 });
    await cancelRequested();
    release();
    const result = await forcing;

    await scanning;
    const spins = result.stderr.split("\r\x1b[K").filter((frame) => frame.startsWith("⠋"));
    expect(spins.length).toBeGreaterThan(0);
    expect(spins.every((frame) => frame.length < 20 && frame.endsWith("…"))).toBe(true);
  });

  it("gives up when the server's Scan or Discovery does not stop in time, and exits 1", async () => {
    const { scanning, release } = await serverScan();

    const result = await cli(["discover", "--force"], { cancelTimeoutMs: 200 });

    release();
    expect(await scanning).toMatchObject({ kind: "scanned" });
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "awol: the dashboard's Scan did not stop within 0.2s\n",
      opened: [],
    });
  });

  it("takes over, without stopping it, from a process that is no longer awol, as when its pid was given to another", async () => {
    await withUnrelatedProcess(async (pid) => {
      await writeRunning(pid, "awol scan");

      const result = await cli(["discover", "--force"]);

      expect(result.stdout.split("\n")[0]).toBe("Took over a stale lock");
      expect(result.code).toBe(0);
      expect(isAlive(pid)).toBe(true);
    });
  });

  it("is given at most once, and scan takes no --failed", async () => {
    for (const argv of [["scan", "--force", "--force"], ["discover", "--failed", "--force", "--failed"], ["scan", "--failed"]]) {
      expect(await cli(argv), argv.join(" ")).toEqual({ code: 2, stdout: "", stderr: `${USAGE}\n`, opened: [] });
    }
  });
});

describe("awol monitor", () => {
  const ON_A_TERMINAL = { stdin: true, stdout: true, stderr: false };

  // The checklist as it starts, after a Discovery that found the Lambda
  // function function-6 and nothing else, with Lambda the one Monitored
  // service.
  const CHECKLIST = [
    "Choose Monitored services:",
    "> [ ] Aurora                 0 resources",
    "  [ ] ElastiCache Redis OSS  0 resources",
    "  [x] Lambda                 1 resource",
    "  [ ] OpenSearch Service     0 resources",
    "  [ ] RDS                    0 resources",
    "↑/↓ move · space toggle · enter save · esc quit",
  ];

  // The account after a Discovery, with Lambda as its one Monitored service.
  async function discoveredMonitoringLambda() {
    const awol = awolWith(fakeAws());
    expect((await awol.discover()).kind).toBe("discovered");
    expect(await awol.setMonitoredServices(["Lambda"])).toEqual({ kind: "saved" });
  }

  async function monitoredServices() {
    const model = await awolWith(fakeAws()).pageModel();
    return model.kind === "signed-in" ? model.monitoredServices : model;
  }

  it("lists every supported service with its resources, the Monitored services ticked, and saves the ticked ones on enter", async () => {
    await discoveredMonitoringLambda();
    const screens: string[][] = [];

    const result = await cli(["monitor"], { terminal: ON_A_TERMINAL, pressed: ["space", "enter"], screens });

    expect(screens[0]).toEqual(CHECKLIST);
    expect(screenOf(result.stdout)).toEqual(["Monitoring", "  ✔ Aurora", "  ✔ Lambda"]);
    expect(result).toMatchObject({ code: 0, stderr: "", opened: [] });
    expect(await monitoredServices()).toEqual(["Aurora", "Lambda"]);
  });

  it("moves between rows with up and down, stopping at the first and the last, and toggles the row it is on", async () => {
    await discoveredMonitoringLambda();
    const screens: string[][] = [];
    const down = Array<Key>(6).fill("down");

    const result = await cli(["monitor"], { terminal: ON_A_TERMINAL, pressed: ["up", "down", "down", "space", ...down, "space", "up", "enter"], screens });

    expect(screens[1]).toEqual(CHECKLIST);
    expect(screens[3]!.slice(1, 6)).toEqual([
      "  [ ] Aurora                 0 resources",
      "  [ ] ElastiCache Redis OSS  0 resources",
      "> [x] Lambda                 1 resource",
      "  [ ] OpenSearch Service     0 resources",
      "  [ ] RDS                    0 resources",
    ]);
    expect(screens.at(-2)!.slice(1, 6)).toEqual([
      "  [ ] Aurora                 0 resources",
      "  [ ] ElastiCache Redis OSS  0 resources",
      "  [ ] Lambda                 1 resource",
      "  [ ] OpenSearch Service     0 resources",
      "> [x] RDS                    0 resources",
    ]);
    expect(result.code).toBe(0);
    expect(await monitoredServices()).toEqual(["RDS"]);
  });

  it("keeps the checklist open on enter with nothing ticked, saying to choose one until one is ticked", async () => {
    await discoveredMonitoringLambda();
    const screens: string[][] = [];

    const result = await cli(["monitor"], {
      terminal: ON_A_TERMINAL,
      pressed: ["down", "down", "space", "enter", "down", "space", "enter"],
      screens,
    });

    expect(screens[4]!.slice(6)).toEqual(["Choose at least one service", "↑/↓ move · space toggle · enter save · esc quit"]);
    expect(screens[5]!.slice(6)).toEqual(["Choose at least one service", "↑/↓ move · space toggle · enter save · esc quit"]);
    expect(screens[6]!.slice(6)).toEqual(["↑/↓ move · space toggle · enter save · esc quit"]);
    expect(screenOf(result.stdout)).toEqual(["Monitoring", "  ✔ OpenSearch Service"]);
    expect(await monitoredServices()).toEqual(["OpenSearch Service"]);
  });

  it("saves nothing on enter when the ticked services are the Monitored services already, and says what they are", async () => {
    await discoveredMonitoringLambda();
    const aws = fakeAws();

    const result = await cli(["monitor"], { aws, terminal: ON_A_TERMINAL, pressed: ["space", "space", "enter"] });

    expect(screenOf(result.stdout)).toEqual(["Monitoring", "  ✔ Lambda"]);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(aws.calls).toEqual([CALLER_IDENTITY]);
  });

  it.each<[Key, number, string]>([
    ["escape", 1, "awol: nothing saved\n"],
    ["q", 1, "awol: nothing saved\n"],
    ["ctrl-c", 130, ""],
  ])("saves nothing on %s, leaving nothing on the screen, and exits %i", async (key, code, stderr) => {
    await discoveredMonitoringLambda();
    const aws = fakeAws();

    const result = await cli(["monitor"], { aws, terminal: ON_A_TERMINAL, pressed: ["space", key, "enter"] });

    expect(screenOf(result.stdout)).toEqual([]);
    expect(result).toMatchObject({ code, stderr });
    expect(aws.calls).toEqual([CALLER_IDENTITY]);
  });

  it.each<[string, Key[]]>([
    ["saved", ["space", "enter"]],
    ["unchanged", ["enter"]],
    ["escape", ["escape"]],
    ["q", ["q"]],
    ["ctrl-c", ["ctrl-c"]],
  ])("wants no more keys once it ends, %s, so the terminal leaves raw mode", async (_, pressed) => {
    await discoveredMonitoringLambda();
    const keyboard = { closed: false };

    await cli(["monitor"], { terminal: ON_A_TERMINAL, pressed: [...pressed, "down"], keyboard });

    expect(keyboard.closed).toBe(true);
  });

  it("wants no more keys when credentials expire on saving", async () => {
    await discoveredMonitoringLambda();
    const valid = fakeAws();
    const expired = fakeAws({ [CALLER_IDENTITY]: { stderr: EXPIRED } });
    let calls = 0;
    const keyboard = { closed: false };

    const result = await cli(["monitor"], {
      aws: (argv) => (calls++ < 1 ? valid : expired)(argv),
      terminal: ON_A_TERMINAL,
      pressed: ["space", "enter", "down"],
      keyboard,
    });

    expect(result.code).toBe(1);
    expect(keyboard.closed).toBe(true);
  });

  it.each([
    ["stdin", { stdin: false, stdout: true, stderr: true }],
    ["stdout", { stdin: true, stdout: false, stderr: true }],
  ])("refuses when %s is not a terminal, reading nothing, and exits 1", async (_, terminal) => {
    await discoveredMonitoringLambda();
    const aws = fakeAws();

    const result = await cli(["monitor"], { aws, terminal, pressed: ["space", "enter"] });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "awol: awol monitor needs a terminal; choose Monitored services in the dashboard\n",
      opened: [],
    });
    expect(aws.calls).toEqual([]);
  });

  it("refuses before any Discovery has run, saving nothing, and exits 1", async () => {
    const result = await cli(["monitor"], { terminal: ON_A_TERMINAL, pressed: ["space", "enter"] });

    expect(result).toEqual({ code: 1, stdout: "", stderr: "awol: run awol discover first\n", opened: [] });
    expect(await monitoredServices()).toBeUndefined();
  });

  it.each([
    ["before the checklist", 0],
    ["on saving", 1],
  ])("asks to log in again when credentials have expired %s, saving nothing, and exits 1", async (_, validCalls) => {
    await discoveredMonitoringLambda();
    const valid = fakeAws();
    const expired = fakeAws({ [CALLER_IDENTITY]: { stderr: EXPIRED } });
    let calls = 0;

    const result = await cli(["monitor"], {
      aws: (argv) => (calls++ < validCalls ? valid : expired)(argv),
      terminal: ON_A_TERMINAL,
      pressed: ["space", "enter"],
    });

    expect(screenOf(result.stdout)).toEqual([]);
    expect(result).toMatchObject({ code: 1, stderr: `awol: ${EXPIRED.trim()}\n` });
    expect(await monitoredServices()).toEqual(["Lambda"]);
  });

  it.each([
    ["saved", ["space", "enter"], ["  ✔ Aurora", "  ✔ Lambda"]],
    ["unchanged", ["enter"], ["  ✔ Lambda"]],
  ] as const)("points at the dashboard when the server is running, the choice %s", async (_, pressed, ticks) => {
    await discoveredMonitoringLambda();
    await cli(["start"]);

    const result = await cli(["monitor"], { terminal: ON_A_TERMINAL, pressed: [...pressed] });

    expect(screenOf(result.stdout)).toEqual(["Monitoring", ...ticks, "", `See ${url}`]);
    expect(result.code).toBe(0);
  });

  it("colors the row it is on and dims the resources, then the heading and ticks of what it monitors, unless told not to, as by NO_COLOR", async () => {
    await discoveredMonitoringLambda();

    const colored = await cli(["monitor"], { terminal: ON_A_TERMINAL, color: true, pressed: ["enter"] });
    const plain = await cli(["monitor"], { terminal: ON_A_TERMINAL, color: false, pressed: ["enter"] });

    expect(colored.stdout).toContain("\x1b[36m> [ ] Aurora                 \x1b[2m0 resources\x1b[22m\x1b[39m\n");
    expect(colored.stdout).toContain("  [x] Lambda                 \x1b[2m1 resource\x1b[22m\n");
    expect(colored.stdout).toContain("\x1b[1mMonitoring\x1b[22m\n  \x1b[32m✔\x1b[39m Lambda\n");
    expect(plain.stdout).not.toMatch(/\x1b\[\d+m/);
  });

  it("saves while a Scan of the account runs, as the dashboard does", async () => {
    await discoveredMonitoringLambda();
    await withUnrelatedProcess(async (pid) => {
      await writeRunning(pid);

      const result = await cli(["monitor"], { terminal: ON_A_TERMINAL, pressed: ["space", "enter"] });

      expect(result).toMatchObject({ code: 0, stderr: "" });
    });
    expect(await monitoredServices()).toEqual(["Aurora", "Lambda"]);
  });

  it.each([["Lambda"], ["--force"]])("takes no arguments, printing the usage for %s, and exits 2", async (argument) => {
    const aws = fakeAws();

    const result = await cli(["monitor", argument], { aws, terminal: ON_A_TERMINAL, pressed: ["enter"] });

    expect(result).toEqual({ code: 2, stdout: "", stderr: `${USAGE}\n`, opened: [] });
    expect(aws.calls).toEqual([]);
  });
});
