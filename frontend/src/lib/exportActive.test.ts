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

/** Captured once, before any test overrides it — several tests below (F3,
 *  F4) replace `resolveDataset` with a controllable stand-in via
 *  `useApp.setState({ resolveDataset: ... })`. Zustand's `setState` MERGES
 *  by default, so that override otherwise LEAKS forward into every test
 *  that runs after it in file order — not just the app's real `datasets`/
 *  `activeId`/`status`, which the beforeEach below already re-sets every
 *  time. Restoring this explicitly closes that leak. */
const defaultResolveDataset = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  useApp.setState({
    resolveDataset: defaultResolveDataset,
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

  // F3 (2026-09-13 adversarial review of d6e67fb7): a cancel landing WHILE
  // resolveDataset is still in flight used to hit a bare `if (aborted)
  // return;` with no status/toast — the click looked like it did nothing at
  // all. This is the LONGEST cancel window in practice (a lazy Origin book's
  // resolve is a real network fetch), so it's the one most likely to
  // actually get clicked mid-flight.
  it("sets a cancelled status when cancel lands while resolving a still-pending dataset (not silent)", async () => {
    type Ds = ReturnType<typeof useApp.getState>["datasets"][number];
    let resolveDs!: (v: Ds | undefined) => void;
    useApp.setState({
      resolveDataset: vi.fn(() => new Promise<Ds | undefined>((r) => (resolveDs = r))),
    });
    const fn = vi.fn();
    const p = exportActive(useApp.getState, fn);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));

    usePendingOps.getState().ops[0].cancel!();
    // resolveDataset settles AFTER the cancel — the exact lazy-book race.
    resolveDs(useApp.getState().datasets[0]);
    await p;

    expect(fn).not.toHaveBeenCalled(); // never reached the actual export
    expect(useApp.getState().status).toBe("export cancelled");
    expect(toastMsgs()).toEqual([]);
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  // F4 (2026-09-13 round-2 review): resolveDataset can resolve to
  // `undefined` WITHOUT throwing (the dataset vanished from the store
  // mid-resolve) — the sibling case to the test above, but with no abort at
  // all. This used to hit a bare `if (!ds) return;` with no status/toast,
  // the identical defect F3 fixed for the abort branch right next to it.
  // Sabotage: revert the `!ds` branch to a bare `return;` and this fails.
  it("reports export-failed (not silent) when the dataset resolves to undefined with no cancel involved", async () => {
    type Ds = ReturnType<typeof useApp.getState>["datasets"][number];
    useApp.setState({
      resolveDataset: vi.fn(() => Promise.resolve(undefined as Ds | undefined)),
    });
    const fn = vi.fn();
    await exportActive(useApp.getState, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("export failed: dataset is no longer available");
    expect(toastMsgs()).toEqual(["export failed: dataset is no longer available"]);
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  // F1 (2026-09-13 round-2 review of the fix round): the "discards a late
  // resolve" test above pins the DOWNLOAD case, where the race is genuinely
  // unreachable. For a COPY, `fn` resolving successfully here means
  // copyImageAsync/copySvgAsync already returned `true` — which only
  // happens after `navigator.clipboard.write(...)` itself resolved, i.e. the
  // write is DONE. Reporting "copy cancelled" in that case is the exact
  // user-visible lie the second review round found: the status bar would
  // say nothing happened while the figure sits on the clipboard. This is
  // the reviewer's own gated-read probe shape (abort landing strictly AFTER
  // the copy's own promise has already settled). Sabotage: delete the
  // `verb === "copy"` branch (fall through to `cancelled(s, verb)`
  // unconditionally) and this fails — status would read "copy cancelled".
  it("reports a copy as done, not cancelled, when fn (the clipboard write) resolves successfully AFTER cancel lands", async () => {
    let resolveFn!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (resolveFn = r)));
    const p = exportActive(useApp.getState, fn, { verb: "copy", past: "copied" });
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));

    usePendingOps.getState().ops[0].cancel!();
    // The clipboard write already completed by the time fn resolves — see
    // this module's own "Race guard" comment.
    resolveFn();
    await p;

    expect(useApp.getState().status).toBe("copied scan — cancel arrived too late to stop it");
    expect(useApp.getState().status).not.toBe("copy cancelled");
    expect(toastMsgs()).toEqual(["copied scan — cancel arrived too late to stop it"]);
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });
});
