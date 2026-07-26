import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAction, type Action } from "./commands";
import { usePendingOps } from "./pendingOps";

beforeEach(() => usePendingOps.setState({ ops: [] }));

function action(over: Partial<Action> = {}): Action {
  return { id: "x", group: "File", label: "Do the thing", run: vi.fn(), ...over };
}

describe("runAction (P3.4 slice 2 chokepoint)", () => {
  it("runs a sync command and never registers a pending op", () => {
    const run = vi.fn();
    runAction(action({ run }));
    expect(run).toHaveBeenCalledOnce();
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("an async command registers under its label, then unregisters on resolve", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    const run = vi.fn(() => pending);
    runAction(action({ label: "Export figure…", run }));

    expect(run).toHaveBeenCalledOnce();
    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].label).toBe("Export figure…");

    resolve();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("a rejecting async command still unregisters (and does not throw out of runAction)", async () => {
    let reject!: (e: Error) => void;
    const pending = new Promise<void>((_resolve, rj) => {
      reject = rj;
    });
    const run = vi.fn(() => pending);

    expect(() => runAction(action({ run }))).not.toThrow();
    expect(usePendingOps.getState().ops).toHaveLength(1);

    reject(new Error("export failed"));
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
  });

  it("calls run() exactly once even when it returns a thenable", () => {
    const run = vi.fn(() => Promise.resolve());
    runAction(action({ run }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a command returning a non-promise object is treated as sync", () => {
    const run = vi.fn(() => ({ ok: true }) as unknown as void);
    runAction(action({ run }));
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });
});
