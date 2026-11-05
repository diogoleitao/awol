// What reading one part of a Scan gave: its result and when it was read, or
// the error it failed with. A read that failed keeps the result of the last
// successful read, and when that was; one never read successfully has its
// error only.
export type PartRead<T> = { result: T; readAt: string; error?: string } | { error: string };

// A read that failed with `error`, keeping the result of `last`, the last
// read, if it has one.
export function failedRead<T>(error: string, last: PartRead<T> | undefined): PartRead<T> {
  return last !== undefined && "result" in last ? { result: last.result, readAt: last.readAt, error } : { error };
}

// The result of `read`, fresh or Stale, if it has one.
export function resultOf<T>(read: PartRead<T> | undefined): T | undefined {
  return read !== undefined && "result" in read ? read.result : undefined;
}

// When a Stale `read` was last read successfully. A fresh read, and one
// never read successfully, are not Stale.
export function staleSince(read: PartRead<unknown> | undefined): string | undefined {
  return read?.error !== undefined && "result" in read ? read.readAt : undefined;
}
