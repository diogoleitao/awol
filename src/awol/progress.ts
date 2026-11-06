import type { PartRead } from "../part-read.ts";
import type { Service } from "./component.ts";
import type { AwsService, DiscoveryPart } from "./discovery.ts";
import type { ScanPart } from "./scan.ts";

// A step of a Scan or Discovery, done once its part in every region is: the
// account's regions read, one AWS service's resources counted, one service's
// versions read, one service's Components scanned, or the Release Cycles of
// every Product read from endoflife.date.
export type Step =
  | { kind: "regions" }
  | { kind: "counted"; awsService: AwsService }
  | { kind: "versions"; service: Service }
  | { kind: "scanned"; service: Service }
  | { kind: "endoflife.date" };

// A part of a Scan or Discovery.
export type Part = ScanPart | DiscoveryPart;

// A part that could not be read, with its error.
type Failure = { part: Part; error: string };

// What a Scan or Discovery tells as it runs: how many of the parts it knows
// of so far are done, each time either changes, a part that could not be
// read, and a step that is done.
export type Progress = { kind: "parts"; done: number; total: number } | ({ kind: "failed" } & Failure) | { kind: "step-done"; step: Step };

// The failure of `part`, if `read` could not read it.
export function failureOf(part: Part, read: PartRead<unknown>): Failure | undefined {
  return read.error === undefined ? undefined : { part, error: read.error };
}

// Counts the parts of a Scan or Discovery, and the parts of each step, telling
// `tell` as they are found and done. A step is told done once it is closed,
// so no more of its parts can be found, and every one of its parts is done.
// A step with no parts is told only if it was closed to be told anyway.
export function progressOf(tell: (progress: Progress) => void = () => {}) {
  let done = 0;
  let total = 0;
  const steps = new Map<string, { step: Step; parts: number; done: number; closed: boolean; evenEmpty: boolean; told: boolean }>();

  function stepOf(step: Step) {
    const key = JSON.stringify(step);
    let entry = steps.get(key);
    if (entry === undefined) steps.set(key, (entry = { step, parts: 0, done: 0, closed: false, evenEmpty: false, told: false }));
    return entry;
  }

  function tellIfDone(entry: ReturnType<typeof stepOf>) {
    if (!entry.closed || entry.told || (entry.parts === 0 && !entry.evenEmpty) || entry.done < entry.parts) return;
    entry.told = true;
    tell({ kind: "step-done", step: entry.step });
  }

  return {
    // `count` more parts found, of `step` if they count towards one.
    found(count: number, step?: Step) {
      if (count === 0) return;
      if (step !== undefined) stepOf(step).parts += count;
      total += count;
      tell({ kind: "parts", done, total });
    },

    // No more parts of `step` will be found. With `evenEmpty`, the step is
    // told done even if it has none.
    close(step: Step, { evenEmpty = false }: { evenEmpty?: boolean } = {}) {
      const entry = stepOf(step);
      entry.closed = true;
      entry.evenEmpty = evenEmpty;
      tellIfDone(entry);
    },

    // A part of `step`, if it counts towards one, read, kept as it was, or
    // failed with `failure`.
    done(step: Step | undefined, failure?: Failure) {
      done += 1;
      if (failure !== undefined) tell({ kind: "failed", ...failure });
      tell({ kind: "parts", done, total });
      if (step === undefined) return;
      const entry = stepOf(step);
      entry.done += 1;
      tellIfDone(entry);
    },
  };
}
