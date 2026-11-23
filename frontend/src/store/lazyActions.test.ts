// Bundle diet slice 32: proxies for slice actions whose bodies load on demand.
// A cold call waits for the load and runs in call order; a warm call is the
// plain synchronous call; a failed load is reported once and drops the waiting
// calls, after which cold calls are refused (never queued) until a background
// reload lands. The load is gated behind a manual
// promise so every race is forced, never timed.
import { describe, expect, it, vi } from "vitest";

import { lazyActions } from "./lazyActions";

interface Slice {
  add: (n: number) => number;
  note: (s: string) => void;
}

function gate<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const bodies = (log: string[]): Slice => ({
  add: (n) => n + 1,
  note: (s) => void log.push(s),
});

describe("lazyActions", () => {
  it("runs calls made before the load in call order, once it lands", async () => {
    const g = gate<Slice>();
    const log: string[] = [];
    const l = lazyActions<Slice, keyof Slice>(["add", "note"], () => g.promise, vi.fn());
    l.actions.note("first");
    l.actions.note("second");
    expect(log).toEqual([]);
    g.resolve(bodies(log));
    await l.warm();
    await Promise.resolve();
    expect(log).toEqual(["first", "second"]);
  });

  it("is a plain synchronous call once warm, and returns the body's value", async () => {
    const log: string[] = [];
    const l = lazyActions<Slice, keyof Slice>(["add", "note"], () => Promise.resolve(bodies(log)), vi.fn());
    await l.warm();
    expect(l.actions.add(41)).toBe(42);
    l.actions.note("now");
    expect(log).toEqual(["now"]);
  });

  it("reports a failed load once, drops every waiting call, and a later warm retries", async () => {
    const onFail = vi.fn();
    const log: string[] = [];
    let attempt = 0;
    const g = gate<Slice>();
    const l = lazyActions<Slice, keyof Slice>(
      ["add", "note"],
      () => (++attempt === 1 ? g.promise : Promise.resolve(bodies(log))),
      onFail,
    );
    l.actions.note("a");
    l.actions.note("b");
    g.reject(new Error("offline"));
    await l.warm();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);

    await l.warm(); // an explicit warm retries
    l.actions.note("c");
    expect(log).toEqual(["c"]); // synchronous: the bodies are in
    expect(attempt).toBe(2);
  });

  it("forgets the loaded bodies on reset, so the next call is cold again", async () => {
    const log: string[] = [];
    let loads = 0;
    const l = lazyActions<Slice, keyof Slice>(
      ["add", "note"],
      () => (loads++, Promise.resolve(bodies(log))),
      vi.fn(),
    );
    await l.warm();
    l.resetForTests();
    l.actions.note("x");
    expect(log).toEqual([]);
    await l.warm();
    await Promise.resolve();
    expect(log).toEqual(["x"]);
    expect(loads).toBe(2);
  });

  it("after a failed load refuses cold calls (nothing queues), reports once, and warms in the background", async () => {
    const onFail = vi.fn();
    const log: string[] = [];
    let attempt = 0;
    const l = lazyActions<Slice, keyof Slice>(
      ["add", "note"],
      () => (++attempt === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(bodies(log))),
      onFail,
    );
    await l.warm();
    expect(onFail).toHaveBeenCalledWith(expect.any(Error), "warm");

    // A refusal returns undefined, never a Promise holding the call's arguments.
    expect(l.actions.note("a")).toBeUndefined();
    expect(l.actions.add(1)).toBeUndefined();
    expect(onFail.mock.calls.filter((c) => c[1] === "refused")).toHaveLength(1);
    await vi.waitFor(() => expect(attempt).toBe(2)); // the background reload that only warms
    await l.warm();
    expect(log).toEqual([]); // the refused call never ran, even though the reload succeeded
    expect(l.actions.add(41)).toBe(42); // synchronous again
    expect(onFail.mock.calls.filter((c) => c[1] === "refused")).toHaveLength(1);
  });

  it("a new failure episode after a recovery reports again", async () => {
    const onFail = vi.fn();
    let ok = false;
    const l = lazyActions<Slice, keyof Slice>(
      ["add", "note"],
      () => (ok ? Promise.resolve(bodies([])) : Promise.reject(new Error("offline"))),
      onFail,
    );
    await l.warm();
    l.actions.note("a");
    ok = true;
    await vi.waitFor(() => expect(l.actions.add(1)).toBe(2));
    l.resetForTests();
    ok = false;
    await l.warm();
    l.actions.note("b");
    expect(onFail.mock.calls.map((c) => c[1])).toEqual(["warm", "refused", "warm", "refused"]);
  });
});
