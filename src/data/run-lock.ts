import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ifExists, writeFileAtomically } from "../fs.ts";
import { isAlive } from "../process.ts";

// What started a Scan or Discovery.
export type Starter = "the dashboard" | "the server on start" | "awol discover" | "awol scan";

// A Scan or Discovery of an account running now: which, who started it, and
// when.
export type Running = { operation: "Scan" | "Discovery"; startedBy: Starter; startedAt: string };

// What taking the lock gives: the lock, to release once the Scan or
// Discovery ends, with a check for a request to cancel it, to make before
// each part, or the one already running and the process running it.
export type Taken =
  | { kind: "taken"; release(): Promise<void>; stopIfCancelled(): Promise<void> }
  | { kind: "busy"; running: Running; pid: number };

// What a Scan or Discovery asked to cancel throws at its next part.
export class Cancelled extends Error {
  constructor() {
    super("cancelled on request");
    this.name = "Cancelled";
  }
}

// A lock, or a request to cancel the Scan or Discovery holding it: the Scan
// or Discovery, and the process that holds the lock.
type Held = { pid: number; running: Running };

// Whether `a` and `b` are the same Scan or Discovery, run by the same
// process.
function sameRun(a: Held, b: Held): boolean {
  return a.pid === b.pid && a.running.startedAt === b.running.startedAt && a.running.operation === b.running.operation;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The lock written as `text`, or none if `text` is not one, as when it is
// corrupt.
function heldOf(text: string | undefined): Held | undefined {
  if (text === undefined) return undefined;
  try {
    const { pid, ...running } = JSON.parse(text) as Running & { pid: number };
    return { pid, running };
  } catch {
    return undefined;
  }
}

// The code of a file system error, such as EEXIST.
function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

// The lock that lets one Scan or Discovery of an account run at a time,
// across every awol process: a file in the account's directory `dir`
// naming the process that holds it, and beside it, while one is asked to,
// a request to cancel the Scan or Discovery holding it.
export function openRunLock(dir: string) {
  const lockPath = path.join(dir, "running.json");
  const cancelPath = path.join(dir, "cancel.json");

  // Removes the lock if this process holds it. It does not wait, so it can
  // run as the process exits.
  function releaseIfHeld() {
    let text: string;
    try {
      text = readFileSync(lockPath, "utf8");
    } catch {
      return;
    }
    if (heldOf(text)?.pid === process.pid) rmSync(lockPath, { force: true });
  }

  return {
    // The Scan or Discovery running now, if any. One whose process is gone,
    // as after a crash, is not running.
    async running(): Promise<Running | undefined> {
      const held = heldOf(await ifExists(readFile(lockPath, "utf8")));
      return held !== undefined && isAlive(held.pid) ? held.running : undefined;
    },

    // Takes the lock for `running`, unless a Scan or Discovery whose process
    // is there holds it. The lock is written whole beside the lock file, then
    // linked to it, which fails if it exists, so no reader sees half a lock
    // and only one taker wins. A lock whose process is gone, or that is
    // corrupt, is moved aside and taken over. Two takers can both find it
    // gone, so the one that moves it aside checks what it moved: when the
    // other has taken the lock since, that lock is put back. A lock held by
    // `takeOver`, a process known not to run a Scan or Discovery any more,
    // is taken over too. The lock is released if this process exits holding
    // it.
    async take(running: Running, takeOver?: number): Promise<Taken> {
      // Whether `held` is a lock to leave to its process.
      const isHeld = (held: Held | undefined): held is Held => held !== undefined && held.pid !== takeOver && isAlive(held.pid);
      await mkdir(dir, { recursive: true });
      const temp = `${lockPath}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ ...running, pid: process.pid }));
      try {
        for (;;) {
          try {
            await link(temp, lockPath);
            break;
          } catch (error) {
            if (errorCode(error) !== "EEXIST") throw error;
          }
          const held = heldOf(await ifExists(readFile(lockPath, "utf8")));
          if (isHeld(held)) return { kind: "busy", running: held.running, pid: held.pid };
          const aside = `${lockPath}.${randomUUID()}.gone`;
          try {
            await rename(lockPath, aside);
          } catch (error) {
            // Another taker moved it first.
            if (errorCode(error) === "ENOENT") continue;
            throw error;
          }
          try {
            const moved = heldOf(await readFile(aside, "utf8"));
            if (isHeld(moved)) {
              // A third taker that took the lock while it was aside keeps
              // it, and the one whose lock was moved runs on with none.
              await link(aside, lockPath).catch((error: unknown) => {
                if (errorCode(error) !== "EEXIST") throw error;
              });
              return { kind: "busy", running: moved.running, pid: moved.pid };
            }
          } finally {
            await rm(aside, { force: true });
          }
        }
      } finally {
        await rm(temp, { force: true });
      }
      process.once("exit", releaseIfHeld);
      const ours: Held = { pid: process.pid, running };
      // Whether a request to cancel this Scan or Discovery is there.
      const cancelRequested = async () => {
        const request = heldOf(await ifExists(readFile(cancelPath, "utf8")));
        return request !== undefined && sameRun(request, ours);
      };
      return {
        kind: "taken",
        async release() {
          process.off("exit", releaseIfHeld);
          releaseIfHeld();
          if (await cancelRequested()) await rm(cancelPath, { force: true });
        },
        async stopIfCancelled() {
          if (await cancelRequested()) throw new Cancelled();
        },
      };
    },

    // Asks the Scan or Discovery `running` that the process `pid` runs to
    // stop at its next part, and waits until it no longer holds the lock, up
    // to `timeoutMs`. Gives whether it let go in time; one that did not is
    // asked no longer.
    async cancel(pid: number, running: Running, timeoutMs: number): Promise<boolean> {
      const target: Held = { pid, running };
      await writeFileAtomically(cancelPath, JSON.stringify({ ...running, pid }));
      const deadline = Date.now() + timeoutMs;
      let stopped = false;
      for (;;) {
        const held = heldOf(await ifExists(readFile(lockPath, "utf8")));
        if (held === undefined || !sameRun(held, target) || !isAlive(pid)) {
          stopped = true;
          break;
        }
        if (Date.now() > deadline) break;
        await sleep(50);
      }
      const request = heldOf(await ifExists(readFile(cancelPath, "utf8")));
      if (request !== undefined && sameRun(request, target)) await rm(cancelPath, { force: true });
      return stopped;
    },
  };
}
