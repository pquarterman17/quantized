// PRIMARY_SOFTWARE_AUDIT_PLAN P3.4 (safe cancel for long export operations):
// exportActive is the shared chokepoint every CSV/HDF5/figure/Origin export
// and figure copy routes through (see this module's own header), so its
// cancel wiring is tested once here rather than once per export kind.
// Kind-specific coverage (figure/page/copy-to-clipboard) lives beside each
// command body: exportFigureCommand.test.ts, exportPageCommand.test.ts,
// copyFigureCommand.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportActive } from "./exportActive";
import { usePendingOps } from "../store/pendingOps";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";

/** An AbortError shaped like what a real aborted `fetch` rejects with —
 *  mirrors store/importDatasets.test.ts's own `abortError` helper so the two
 *  cancel-detection code paths (import's runImport, export's exportActive)
 *  are exercised the same way. */
function abortError(): Error {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

function toastMsgs(): string[] {
  return useToasts.getState().toasts.map((t) => t.msg);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
    activeId: "d1",
    status: "",
  });
});

describe("exportActive — pending-op registration", () => {
  it("registers a cancellable op labeled with the dataset name while fn is in flight", async () => {
    let resolve!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const p = exportActive(useApp.getState, fn);

    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    expect(usePendingOps.getState().ops[0].label).toBe("Exporting scan.dat…");
    expect(typeof usePendingOps.getState().ops[0].cancel).toBe("function");

    resolve();
    await p;
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("uses the given verb for the op label ('Copying…' for Copy figure)", async () => {
    let resolve!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const p = exportActive(useApp.getState, fn, { verb: "copy", past: "copied" });
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    expect(usePendingOps.getState().ops[0].label).toBe("Copying scan.dat…");
    resolve();
    await p;
  });

  it("passes an AbortSignal to fn that is actually aborted once the pendingOps cancel runs", async () => {
    let capturedSignal: AbortSignal | undefined;
    let reject!: (e: unknown) => void;
    const fn = vi.fn((_stem: string, _ds: unknown, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<void>((_r, rj) => (reject = rj));
    });
    const p = exportActive(useApp.getState, fn);
    await vi.waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal));
    expect(capturedSignal!.aborted).toBe(false);

    usePendingOps.getState().ops[0].cancel!();
    expect(capturedSignal!.aborted).toBe(true);

    reject(abortError());
    await p;
  });
});

describe("exportActive — cancel outcome", () => {
  it("clears the busy indicator, sets a cancelled status, and shows no toast at all", async () => {
    let reject!: (e: unknown) => void;
    const fn = vi.fn(() => new Promise<void>((_r, rj) => (reject = rj)));
    const p = exportActive(useApp.getState, fn);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));

    usePendingOps.getState().ops[0].cancel!();
    reject(abortError());
    await p;

    expect(usePendingOps.getState().ops).toHaveLength(0);
    expect(useApp.getState().status).toBe("export cancelled");
    expect(toastMsgs()).toEqual([]); // no error toast, no success toast either
  });

  it("uses the given verb in the cancelled status ('copy cancelled')", async () => {
    let reject!: (e: unknown) => void;
    const fn = vi.fn(() => new Promise<void>((_r, rj) => (reject = rj)));
    const p = exportActive(useApp.getState, fn, { verb: "copy", past: "copied" });
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    usePendingOps.getState().ops[0].cancel!();
    reject(abortError());
    await p;
    expect(useApp.getState().status).toBe("copy cancelled");
  });

  // The race this guards: fn's underlying transport (postDownload/postBlob)
  // resolves successfully right as Cancel is clicked — must never be
  // reported as a completed export. See exportActive.ts's own "Race guard"
  // comment; this exercises exportActive's belt-and-suspenders check
  // directly, independent of postDownload/postBlob's own abort-race guard
  // (lib/api/http.test.ts covers that half).
  it("discards a late resolve: fn succeeding AFTER cancel must not toast success or download", async () => {
    let resolveFn!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (resolveFn = r)));
    const p = exportActive(useApp.getState, fn);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));

    usePendingOps.getState().ops[0].cancel!();
    // fn resolves SUCCESSFULLY despite the cancel (the exact race: the
    // response had already landed when Cancel was clicked).
    resolveFn();
    await p;

    expect(toastMsgs()).toEqual([]); // no "exported scan" success toast
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("a real failure unrelated to cancel still reports export-failed, not cancelled", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("network down")));
    await exportActive(useApp.getState, fn);
    expect(useApp.getState().status).toBe("export failed: network down");
    expect(toastMsgs()).toEqual(["export failed: network down"]);
  });
});
