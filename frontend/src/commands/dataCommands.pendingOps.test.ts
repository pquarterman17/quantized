// Regression test for a lint-sweep bug (commit 2b788f3): `run: () => void
// s().mergeSelected()` and the duplicate-dataset run body dropped the
// promise at the producer boundary, so `runAction` (store/commands.ts) could
// no longer see a thenable and silently stopped registering the StatusBar
// pending-op for these two commands. `no-misused-promises` is configured
// with `checksVoidReturn: { properties: false }` precisely so `Action.run:
// () => void` may legitimately return a promise — restoring the return is
// the fix, not adding `void` back.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDataCommands } from "./dataCommands";
import { runAction } from "../store/commands";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

beforeEach(() => {
  usePendingOps.setState({ ops: [] });
});

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("dataCommands — merge/duplicate register a pending op (regression, commit 2b788f3)", () => {
  it("merge registers a pending op while mergeSelected() is in flight, then clears on resolve", async () => {
    const { promise, resolve } = deferred<void>();
    useApp.setState({ mergeSelected: vi.fn(() => promise) });

    const merge = buildDataCommands(useApp.getState).find((c) => c.id === "merge");
    expect(merge).toBeDefined();

    runAction(merge!);

    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].label).toBe(merge!.label);

    resolve();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("merge clears the pending op even when mergeSelected() rejects", async () => {
    const { promise, reject } = deferred<void>();
    useApp.setState({ mergeSelected: vi.fn(() => promise) });

    const merge = buildDataCommands(useApp.getState).find((c) => c.id === "merge");
    expect(() => runAction(merge!)).not.toThrow();
    expect(usePendingOps.getState().ops).toHaveLength(1);

    reject(new Error("merge failed"));
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("duplicate registers a pending op while duplicateDataset() is in flight, then clears on resolve", async () => {
    const { promise, resolve } = deferred<void>();
    useApp.setState({ activeId: "ds-1", duplicateDataset: vi.fn(() => promise) });

    const duplicate = buildDataCommands(useApp.getState).find((c) => c.id === "duplicate");
    expect(duplicate).toBeDefined();

    runAction(duplicate!);

    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].label).toBe(duplicate!.label);

    resolve();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("duplicate clears the pending op even when duplicateDataset() rejects", async () => {
    const { promise, reject } = deferred<void>();
    useApp.setState({ activeId: "ds-1", duplicateDataset: vi.fn(() => promise) });

    const duplicate = buildDataCommands(useApp.getState).find((c) => c.id === "duplicate");
    expect(() => runAction(duplicate!)).not.toThrow();
    expect(usePendingOps.getState().ops).toHaveLength(1);

    reject(new Error("duplicate failed"));
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });
});
