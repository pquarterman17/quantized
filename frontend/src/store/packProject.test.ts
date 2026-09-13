// P1.7 "Pack Project" PR 4 state machine (store/packProject.ts +
// store/packProjectRun.ts). `../lib/desktopPackBridge` is mocked wholesale
// (the relink.test.ts precedent) so every scenario is driven by controlled
// bridge responses rather than a real pywebview window.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import * as bridge from "../lib/desktopPackBridge";
import type { PackStatus, PortableManifest } from "../lib/desktopPackBridge";
import type { Dataset, DataStruct } from "../lib/types";
import {
  EMPTY_PACK_PROGRESS,
  resetStartInFlightForTests,
  usePackProject,
  type PackProjectPhase,
  type PackProjectState,
} from "./packProject";
import {
  pollOnce,
  resetGeneration,
  resetPollSequencing,
  resetThrottle,
  scheduleStatusApply,
  stopPolling,
} from "./packProjectRun";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

// Only the lazy-book fetch is faked (the BUG-011 specs at the bottom drive it);
// everything else in lib/api stays real, the desktopPackBridge mock's own shape.
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchBookData: vi.fn(),
}));

vi.mock("../lib/desktopPackBridge", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pickPackDestination: vi.fn(),
  packPreview: vi.fn(),
  packStart: vi.fn(),
  packStatus: vi.fn(),
  packCancel: vi.fn(),
  packReset: vi.fn(),
}));

const ACTIVE: PackProjectPhase[] = [
  "selecting_destination",
  "scanning",
  "awaiting_confirmation",
  "packing",
  "cancelling",
];
const TERMINAL: PackProjectPhase[] = ["completed", "cancelled", "failed"];
const ALL_PHASES: PackProjectPhase[] = ["idle", ...ACTIVE, ...TERMINAL];

function resetStore(phase: PackProjectPhase, extra: Partial<PackProjectState> = {}): void {
  usePackProject.setState({
    phase,
    progress: EMPTY_PACK_PROGRESS,
    warnings: [],
    errors: [],
    resultPath: null,
    cleanupOk: null,
    preview: null,
    lastRejected: null,
    ...extra,
  });
}

function okManifest(): PortableManifest {
  return {
    format: "quantized-portable-bundle",
    manifest_version: 1,
    dry_run: true,
    project: {
      name: "proj",
      project_file: "proj.dwk",
      workspace_format: "quantized-workspace",
      workspace_version: 4,
      renamed_from: null,
    },
    layout: { manifest_file: "quantized-bundle.json", sources_dir: "sources" },
    sources: [],
    datasets: [],
    warnings: [],
    summary: { datasets: 0, sources: 0, packable: 0, blocked: 0, shared: 0, total_bytes: 0, warnings: 0 },
  };
}

function statusOf(over: Partial<PackStatus>): PackStatus {
  return {
    phase: "packing",
    progress: {
      current_file: null,
      completed_files: 0,
      total_files: 0,
      bytes_copied: 0,
      bytes_total: 0,
      stage: null,
    },
    warnings: [],
    errors: [],
    result: null,
    cleanup_ok: null,
    originals_modified: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bridge.pickPackDestination).mockResolvedValue(null);
  vi.mocked(bridge.packPreview).mockResolvedValue(null);
  vi.mocked(bridge.packStart).mockResolvedValue(null);
  vi.mocked(bridge.packStatus).mockResolvedValue(null);
  vi.mocked(bridge.packCancel).mockResolvedValue(null);
  vi.mocked(bridge.packReset).mockResolvedValue(null);
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], history: [], future: [], status: "" });
  resetStore("idle");
  stopPolling();
  resetThrottle();
  resetPollSequencing();
  resetGeneration();
  resetStartInFlightForTests();
});

afterEach(() => {
  stopPolling();
  resetThrottle();
  resetPollSequencing();
  resetGeneration();
  resetStartInFlightForTests();
  vi.useRealTimers();
});

// -- table-driven transition legality --------------------------------

describe("previewPackProject transition legality", () => {
  it.each(ALL_PHASES)("from %s", async (phase) => {
    resetStore(phase);
    await usePackProject.getState().previewPackProject();
    const s = usePackProject.getState();
    if (ACTIVE.includes(phase)) {
      expect(s.lastRejected).toEqual({ from: phase, action: "previewPackProject" });
      expect(s.phase).toBe(phase);
    } else {
      expect(s.lastRejected).toBeNull();
      // No usable bridge is a FAILURE (bridge_unavailable), not a silent
      // idle: a broken shell must not look like the user pressing Cancel.
      expect(s.phase).toBe("failed");
      expect(s.errors[0]?.code).toBe("bridge_unavailable");
    }
  });
});

describe("startPackProject transition legality", () => {
  it.each(ALL_PHASES)("from %s", async (phase) => {
    resetStore(phase);
    await usePackProject.getState().startPackProject(okManifest());
    const s = usePackProject.getState();
    if (phase !== "awaiting_confirmation") {
      expect(s.lastRejected).toEqual({ from: phase, action: "startPackProject" });
      expect(s.phase).toBe(phase);
      expect(bridge.packStart).not.toHaveBeenCalled();
    } else {
      expect(s.lastRejected).toBeNull();
      // Gate passed; no preview stored -> rejects locally as stale_preview.
      expect(s.phase).toBe("failed");
      expect(bridge.packStart).not.toHaveBeenCalled();
    }
  });
});

describe("cancelPackProject transition legality", () => {
  it.each(ALL_PHASES)("from %s", async (phase) => {
    resetStore(phase);
    vi.mocked(bridge.packCancel).mockResolvedValue({ ok: true, phase: "cancelling" });
    await usePackProject.getState().cancelPackProject();
    const s = usePackProject.getState();
    expect(s.lastRejected).toBeNull(); // cancel is never a "rejection"
    if (phase === "idle" || TERMINAL.includes(phase)) {
      expect(s.phase).toBe(phase); // idempotent no-op
      expect(bridge.packCancel).not.toHaveBeenCalled();
    } else if (phase === "packing" || phase === "cancelling") {
      expect(s.phase).toBe("cancelling");
      expect(bridge.packCancel).toHaveBeenCalledTimes(1);
    } else {
      expect(s.phase).toBe("cancelled"); // selecting_destination/scanning/awaiting_confirmation
      expect(bridge.packCancel).not.toHaveBeenCalled();
    }
  });
});

describe("resetPackProject transition legality", () => {
  it.each(ALL_PHASES)("from %s", async (phase) => {
    resetStore(phase);
    await usePackProject.getState().resetPackProject();
    const s = usePackProject.getState();
    if (phase === "packing" || phase === "cancelling") {
      expect(s.lastRejected).toEqual({ from: phase, action: "resetPackProject" });
      expect(s.phase).toBe(phase);
    } else {
      // Terminal AND pre-packing active phases: a one-step dismiss to idle.
      expect(s.lastRejected).toBeNull();
      expect(s.phase).toBe("idle");
      expect(s.preview).toBeNull();
    }
  });
});

// -- double start ---------------------------------------------------------

it("double startPackProject while packing is rejected", async () => {
  resetStore("packing");
  await usePackProject.getState().startPackProject(okManifest());
  const s = usePackProject.getState();
  expect(s.lastRejected).toEqual({ from: "packing", action: "startPackProject" });
  expect(s.phase).toBe("packing");
  expect(bridge.packStart).not.toHaveBeenCalled();
});

// -- full preview -> start -> completed flow -------------------------------

async function runToAwaitingConfirmation(): Promise<PortableManifest> {
  vi.mocked(bridge.pickPackDestination).mockResolvedValue("/dest");
  const manifest = okManifest();
  vi.mocked(bridge.packPreview).mockResolvedValue({
    ok: true,
    token: "tok-1",
    manifest,
    destination: { bundle_dir: "/dest/proj", exists: false },
    warnings: [],
    blockers: [],
  });
  await usePackProject.getState().previewPackProject();
  expect(usePackProject.getState().phase).toBe("awaiting_confirmation");
  return manifest;
}

describe("cancel before packing (each pre-packing active state)", () => {
  it("selecting_destination -> cancelled without calling the bridge", async () => {
    resetStore("selecting_destination");
    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");
    expect(bridge.packCancel).not.toHaveBeenCalled();
  });

  it("scanning -> cancelled without calling the bridge", async () => {
    resetStore("scanning");
    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");
    expect(bridge.packCancel).not.toHaveBeenCalled();
  });

  it("awaiting_confirmation -> cancelled without calling the bridge", async () => {
    await runToAwaitingConfirmation();
    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");
    expect(bridge.packCancel).not.toHaveBeenCalled();
  });
});

describe("cancel during packing", () => {
  it("packStatus returning cancelling then cancelled resolves the final phase, and polling stops", async () => {
    vi.useFakeTimers();
    const manifest = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest);
    expect(usePackProject.getState().phase).toBe("packing");

    vi.mocked(bridge.packStatus).mockResolvedValueOnce(statusOf({ phase: "packing" }));
    await vi.advanceTimersByTimeAsync(250);
    expect(usePackProject.getState().phase).toBe("packing");

    vi.mocked(bridge.packCancel).mockResolvedValue({ ok: true, phase: "cancelling" });
    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelling");

    vi.mocked(bridge.packStatus).mockResolvedValueOnce(statusOf({ phase: "cancelling" }));
    await vi.advanceTimersByTimeAsync(250);
    expect(usePackProject.getState().phase).toBe("cancelling");

    vi.mocked(bridge.packStatus).mockResolvedValueOnce(statusOf({ phase: "cancelled" }));
    await vi.advanceTimersByTimeAsync(250);
    expect(usePackProject.getState().phase).toBe("cancelled");

    const callsAtTerminal = vi.mocked(bridge.packStatus).mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(bridge.packStatus).mock.calls.length).toBe(callsAtTerminal); // polling stopped
  });

  it("cancel after completion is a no-op", async () => {
    vi.useFakeTimers();
    const manifest = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest);
    vi.mocked(bridge.packStatus).mockResolvedValueOnce(
      statusOf({ phase: "completed", result: { bundle_dir: "/dest/proj" }, cleanup_ok: null }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(usePackProject.getState().phase).toBe("completed");

    vi.mocked(bridge.packCancel).mockClear();
    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("completed");
    expect(bridge.packCancel).not.toHaveBeenCalled();
  });
});

// -- staleness ------------------------------------------------------------

describe("stale preview rejection", () => {
  it("project mutation between preview and start rejects locally without calling packStart", async () => {
    const manifest = await runToAwaitingConfirmation();
    useApp.setState({
      datasets: [
        {
          id: "new",
          name: "new.csv",
          data: { time: [0], values: [[1]], labels: ["m"], units: ["emu"], metadata: {} },
        },
      ],
    });
    await usePackProject.getState().startPackProject(manifest);
    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    expect(s.errors[0].code).toBe("stale_preview");
    expect(bridge.packStart).not.toHaveBeenCalled();
  });

  it("a re-preview against a different destination changes the token; starting with the OLD manifest is rejected", async () => {
    const firstManifest = await runToAwaitingConfirmation();
    // A re-preview is only legal from idle/terminal (the transition-legality
    // table above) -- cancel first, exactly like a user reopening the picker.
    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");
    // Re-preview against a different destination -- a fresh manifest object.
    vi.mocked(bridge.pickPackDestination).mockResolvedValue("/other-dest");
    const secondManifest = okManifest();
    vi.mocked(bridge.packPreview).mockResolvedValue({
      ok: true,
      token: "tok-2",
      manifest: secondManifest,
      destination: { bundle_dir: "/other-dest/proj", exists: false },
      warnings: [],
      blockers: [],
    });
    await usePackProject.getState().previewPackProject();
    expect(usePackProject.getState().preview?.token).toBe("tok-2");

    await usePackProject.getState().startPackProject(firstManifest);
    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    expect(s.errors[0].code).toBe("stale_preview");
    expect(bridge.packStart).not.toHaveBeenCalled();
  });
});

// -- backend failure surfaces -----------------------------------------

describe("backend failures", () => {
  it("packStart returning null (bridge threw or is unavailable) -> failed, carries the note", async () => {
    const manifest = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue(null);
    await usePackProject.getState().startPackProject(manifest);
    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0].code).toBe("bridge_unavailable");
    expect(s.errors[0].originalsModified).toBe(false);
    expect(s.errors[0].note).toBe("No original files or project were modified.");
  });

  it("packStatus reporting failed with cleanup_ok false is reflected in the store", async () => {
    vi.useFakeTimers();
    const manifest = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest);
    vi.mocked(bridge.packStatus).mockResolvedValueOnce(
      statusOf({
        phase: "failed",
        cleanup_ok: false,
        errors: [{ code: "publish_failed", message: "boom", originals_modified: false, note: "note" }],
      }),
    );
    await vi.advanceTimersByTimeAsync(250);
    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    expect(s.cleanupOk).toBe(false);
    expect(s.errors[0].code).toBe("publish_failed");
  });
});

// -- picker cancel leaves no footprint ------------------------------------

it("backing out of the destination picker resets fully (packReset sent) rather than a bare idle", async () => {
  const { CANCELLED } = await import("../lib/desktopBridge");
  vi.mocked(bridge.pickPackDestination).mockResolvedValue(CANCELLED);
  await usePackProject.getState().previewPackProject();
  expect(usePackProject.getState().phase).toBe("idle");
  expect(usePackProject.getState().lastRejected).toBeNull();
  // The backend clears the stale preview and any earlier pick's write-dir
  // grant on reset -- so the reset must actually be sent, every time.
  expect(bridge.packReset).toHaveBeenCalledOnce();
});

// -- retry ------------------------------------------------------------

it("retry after failure via reset -> idle -> preview again works", async () => {
  const manifest = await runToAwaitingConfirmation();
  vi.mocked(bridge.packStart).mockResolvedValue(null);
  await usePackProject.getState().startPackProject(manifest);
  expect(usePackProject.getState().phase).toBe("failed");

  await usePackProject.getState().resetPackProject();
  expect(usePackProject.getState().phase).toBe("idle");

  await runToAwaitingConfirmation();
  expect(usePackProject.getState().phase).toBe("awaiting_confirmation");
  expect(usePackProject.getState().lastRejected).toBeNull();
});

// -- progress: clamp + throttle -----------------------------------------

describe("progress monotonicity", () => {
  it("never regresses bytesCopied/completedCount even when fed a decreasing status", () => {
    const get = () => usePackProject.getState();
    const set = (partial: Partial<PackProjectState>) => usePackProject.setState(partial);
    resetThrottle();

    scheduleStatusApply(
      get,
      set,
      statusOf({ progress: { current_file: "sources/a.csv", completed_files: 1, total_files: 2, bytes_copied: 100, bytes_total: 200, stage: "copying" } }),
      0,
    );
    expect(get().progress.bytesCopied).toBe(100);

    // A misbehaving/out-of-order status reports LESS progress than before.
    scheduleStatusApply(
      get,
      set,
      statusOf({ progress: { current_file: "sources/a.csv", completed_files: 0, total_files: 2, bytes_copied: 10, bytes_total: 200, stage: "copying" } }),
      1000, // far past the throttle window -> would apply immediately if not clamped
    );
    expect(get().progress.bytesCopied).toBe(100); // clamped, never regressed
    expect(get().progress.completedCount).toBe(1);
  });
});

describe("update throttling", () => {
  it("many status changes within 200ms produce exactly one additional (coalesced) store update", () => {
    const get = () => usePackProject.getState();
    const set = (partial: Partial<PackProjectState>) => usePackProject.setState(partial);
    resetThrottle();
    vi.useFakeTimers();

    const seenBytes: number[] = [];
    const unsubscribe = usePackProject.subscribe((s) => seenBytes.push(s.progress.bytesCopied));

    scheduleStatusApply(get, set, statusOf({ progress: { ...statusOf({}).progress, bytes_copied: 10 } }), 0);
    scheduleStatusApply(get, set, statusOf({ progress: { ...statusOf({}).progress, bytes_copied: 20 } }), 50);
    scheduleStatusApply(get, set, statusOf({ progress: { ...statusOf({}).progress, bytes_copied: 30 } }), 100);

    // The immediate apply (10) has landed; 20 must be fully coalesced away.
    expect(seenBytes).toEqual([10]);
    expect(get().progress.bytesCopied).toBe(10);

    vi.advanceTimersByTime(200);

    // The trailing edge fires with the LATEST status (30), never the
    // discarded middle one (20).
    expect(seenBytes).toEqual([10, 30]);
    expect(get().progress.bytesCopied).toBe(30);

    unsubscribe();
  });

  it("polling stops the instant a terminal phase is observed", async () => {
    vi.useFakeTimers();
    const manifest = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest);

    vi.mocked(bridge.packStatus).mockResolvedValueOnce(
      statusOf({ phase: "completed", result: { bundle_dir: "/dest/proj" } }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(usePackProject.getState().phase).toBe("completed");

    const calls = vi.mocked(bridge.packStatus).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.mocked(bridge.packStatus).mock.calls.length).toBe(calls);
  });
});

// -- progress/result reset across runs (review finding #2) ------------------

describe("progress/result reset across runs", () => {
  it("a re-preview after a completed run does not let the old run's progress/result pin the new one", async () => {
    vi.useFakeTimers();
    // Run #1: completes at 3/3 with a resultPath.
    const manifest1 = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest1);
    vi.mocked(bridge.packStatus).mockResolvedValueOnce(
      statusOf({
        phase: "completed",
        progress: {
          current_file: null,
          completed_files: 3,
          total_files: 3,
          bytes_copied: 300,
          bytes_total: 300,
          stage: null,
        },
        result: { bundle_dir: "/dest/proj" },
        cleanup_ok: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(usePackProject.getState().phase).toBe("completed");
    expect(usePackProject.getState().resultPath).toBe("/dest/proj");

    // Re-preview (legal from a terminal phase) for run #2, a fresh manifest.
    vi.mocked(bridge.pickPackDestination).mockResolvedValue("/dest2");
    const manifest2 = okManifest();
    vi.mocked(bridge.packPreview).mockResolvedValue({
      ok: true,
      token: "tok-run2",
      manifest: manifest2,
      destination: { bundle_dir: "/dest2/proj", exists: false },
      warnings: [],
      blockers: [],
    });
    await usePackProject.getState().previewPackProject();
    expect(usePackProject.getState().phase).toBe("awaiting_confirmation");
    // The reset happens at the START of the preview call, before anything
    // about run #2 is even known yet.
    expect(usePackProject.getState().resultPath).toBeNull();
    expect(usePackProject.getState().progress).toEqual(EMPTY_PACK_PROGRESS);

    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest2);
    expect(usePackProject.getState().phase).toBe("packing");
    expect(usePackProject.getState().resultPath).toBeNull(); // never resurrected mid-pack

    // Run #2's first real status reports 0/5 -- the monotonic clamp must
    // not pin it to run #1's stale 3/3.
    vi.mocked(bridge.packStatus).mockResolvedValueOnce(
      statusOf({
        phase: "packing",
        progress: {
          current_file: "sources/a.csv",
          completed_files: 0,
          total_files: 5,
          bytes_copied: 0,
          bytes_total: 500,
          stage: "copying",
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(250);
    const s = usePackProject.getState();
    expect(s.progress.completedCount).toBe(0);
    expect(s.progress.bytesCopied).toBe(0);
    expect(s.progress.totalCount).toBe(5);
    expect(s.resultPath).toBeNull();
  });
});

// -- cancel racing a pending preview continuation (review finding #3) ------

/** `previewPackProject` reaches its bridge call through a lazy `import()`
 *  (store/packProject.ts's own eager-bundle-cost doc), so a fixed number of
 *  `Promise.resolve()` hops is fragile — flush a generous number of
 *  microtask AND macrotask turns instead, enough to reach a promise this
 *  test itself is deliberately leaving unresolved. */
async function flushUntilSuspended(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("cancel racing a pending preview continuation", () => {
  it("cancelling while the folder-dialog promise is pending is not overwritten when it resolves late", async () => {
    let resolveDialog: (value: string) => void = () => {};
    const dialogPromise = new Promise<string>((resolve) => {
      resolveDialog = resolve;
    });
    vi.mocked(bridge.pickPackDestination).mockReturnValue(dialogPromise);

    const previewCall = usePackProject.getState().previewPackProject();
    // Let `previewPackProject` reach `await pickPackDestination()`.
    await flushUntilSuspended();
    expect(usePackProject.getState().phase).toBe("selecting_destination");

    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");

    // The dialog resolves LATE, well after the cancel already landed.
    resolveDialog("/dest");
    await previewCall;

    expect(usePackProject.getState().phase).toBe("cancelled"); // not overwritten
    expect(usePackProject.getState().preview).toBeNull();
    expect(bridge.packPreview).not.toHaveBeenCalled();
  });

  it("cancelling while packPreview is pending is not overwritten when it resolves late", async () => {
    vi.mocked(bridge.pickPackDestination).mockResolvedValue("/dest");
    let resolvePreview: (value: Awaited<ReturnType<typeof bridge.packPreview>>) => void = () => {};
    const previewPromise = new Promise<Awaited<ReturnType<typeof bridge.packPreview>>>((resolve) => {
      resolvePreview = resolve;
    });
    vi.mocked(bridge.packPreview).mockReturnValue(previewPromise);

    const previewCall = usePackProject.getState().previewPackProject();
    // Let the picker resolve and `previewPackProject` reach `scanning`.
    await flushUntilSuspended();
    expect(usePackProject.getState().phase).toBe("scanning");

    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");

    resolvePreview({
      ok: true,
      token: "late-tok",
      manifest: okManifest(),
      destination: { bundle_dir: "/dest/proj", exists: false },
      warnings: [],
      blockers: [],
    });
    await previewCall;

    expect(usePackProject.getState().phase).toBe("cancelled"); // not overwritten
    expect(usePackProject.getState().preview).toBeNull();
  });
});

// -- no undo/history pollution in the open project (P1.7 PR 5 audit item 11) --

describe("a full pack run never touches useApp history or dataset identity", () => {
  it("history/future/datasets are byte-for-byte and reference-identical across preview -> start -> completed", async () => {
    vi.useFakeTimers();
    const datasetsBefore = [
      {
        id: "a",
        name: "a.csv",
        data: { time: [0], values: [[1]], labels: ["m"], units: ["emu"], metadata: {} },
      },
    ];
    useApp.setState({
      datasets: datasetsBefore,
      activeId: "a",
      selectedIds: ["a"],
      history: [],
      future: [],
      status: "",
    });
    const historyBefore = useApp.getState().history;
    const futureBefore = useApp.getState().future;

    const manifest = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest);
    vi.mocked(bridge.packStatus).mockResolvedValueOnce(
      statusOf({ phase: "completed", result: { bundle_dir: "/dest/proj" }, cleanup_ok: null }),
    );
    await vi.advanceTimersByTimeAsync(250);
    expect(usePackProject.getState().phase).toBe("completed");

    // Reference identity, not merely deep equality -- proves nothing ever
    // called `useApp.setState` on these fields at all, whether or not the
    // new value would have looked the same.
    expect(useApp.getState().datasets).toBe(datasetsBefore);
    expect(useApp.getState().history).toBe(historyBefore);
    expect(useApp.getState().future).toBe(futureBefore);
  });
});

// -- overlapping poll responses resolving out of order (review finding #4) --

describe("overlapping poll responses resolving out of order", () => {
  it("an older in-flight response that resolves AFTER a terminal one is dropped", async () => {
    const get = () => usePackProject.getState();
    const set = (partial: Partial<PackProjectState>) => usePackProject.setState(partial);
    resetStore("packing");
    resetPollSequencing();
    resetThrottle();

    let resolveFirst: (s: PackStatus) => void = () => {};
    let resolveSecond: (s: PackStatus) => void = () => {};
    const firstPromise = new Promise<PackStatus>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPromise = new Promise<PackStatus>((resolve) => {
      resolveSecond = resolve;
    });

    vi.mocked(bridge.packStatus).mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise);

    // Two overlapping dispatches -- the second is dispatched before the
    // first resolves at all (a slow first tick, a normal-speed second one).
    const firstPoll = pollOnce(get, set);
    const secondPoll = pollOnce(get, set);

    // The SECOND dispatched poll resolves FIRST, with the terminal phase.
    resolveSecond(statusOf({ phase: "completed", result: { bundle_dir: "/dest/proj" } }));
    await secondPoll;
    expect(get().phase).toBe("completed");

    // The FIRST dispatched poll resolves LAST, with a stale "packing".
    resolveFirst(statusOf({ phase: "packing" }));
    await firstPoll;

    expect(get().phase).toBe("completed"); // never overwritten by the straggler
  });
});

// -- BUG-011: a PENDING lazy book is resolved before anything is serialized --
//
// A `pending` dataset's `data` is the backend's downsampled PREVIEW, not the
// book. Packing it would write decimated rows into a portable bundle as the
// recipient's real measurement, with nothing in the payload saying so. Both
// entry points that serialize (the pack PREVIEW and "Start pack") must resolve
// first and ABORT if a book cannot be fetched — the same contract
// `store/workspaceIO.ts`'s `prepareWorkspaceState` and
// `store/workbookTransfer.ts`'s two export paths already hold.

describe("BUG-011 — pending datasets are resolved before serializing for a pack", () => {
  const previewRows: DataStruct = {
    time: [0, 5],
    values: [[1], [9]],
    labels: ["m"],
    units: ["emu"],
    metadata: { lazy_preview: true },
  };
  const fullRows: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [[1], [2], [3], [4], [5], [9]],
    labels: ["m"],
    units: ["emu"],
    metadata: {},
  };

  function lazyBook(id = "lazy1"): Dataset {
    return {
      id,
      name: `${id}.opj`,
      data: previewRows,
      pending: { kind: "path", path: `/${id}.opj`, bookId: "Book2", rows: 6, cols: 1 },
    };
  }

  /** The serialized dataset the bridge was handed, by dataset id. */
  function packedDataset(content: string, id: string): Record<string, unknown> {
    const doc = JSON.parse(content) as { datasets: Record<string, unknown>[] };
    return doc.datasets.find((d) => d.id === id)!;
  }

  beforeEach(() => {
    resetBookTransportForTests();
    useToasts.setState({ toasts: [] });
    vi.mocked(fetchBookData).mockReset();
  });

  it("the pack PREVIEW sends the FULL book, with no `pending` field in the payload", async () => {
    useApp.setState({ datasets: [lazyBook()], plotWindows: [], focusedWindowId: null });
    vi.mocked(fetchBookData).mockResolvedValue(fullRows);
    vi.mocked(bridge.packPreview).mockResolvedValue({
      ok: true,
      token: "tok-1",
      manifest: okManifest(),
      destination: { bundle_dir: "/dest/proj", exists: false },
      warnings: [],
      blockers: [],
    });

    await usePackProject.getState().previewPackProject("/dest");

    expect(usePackProject.getState().phase).toBe("awaiting_confirmation");
    const [content] = vi.mocked(bridge.packPreview).mock.calls[0];
    const packed = packedDataset(content, "lazy1");
    expect(packed.data).toEqual(fullRows); // the book, not the 2-row preview
    expect(packed).not.toHaveProperty("pending");
    expect(content).not.toContain('"pending"');
  });

  it("a book that cannot be fetched REFUSES the preview by name, and never calls the bridge", async () => {
    useApp.setState({ datasets: [lazyBook()], plotWindows: [], focusedWindowId: null });
    vi.mocked(fetchBookData).mockRejectedValue(new Error("moved or deleted"));

    await usePackProject.getState().previewPackProject("/dest");

    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0].code).toBe("pending_unresolved");
    expect(s.errors[0].message).toContain("couldn't load full data for every book");
    expect(s.errors[0].message).toContain("moved or deleted");
    // Review finding #5: the refusal actually NAMES the book (previously it
    // named only the operation and the fetch error) -- `lazyBook()` defaults
    // to id "lazy1", name "lazy1.opj".
    expect(s.errors[0].message).toContain('"lazy1.opj"');
    expect(s.errors[0].originalsModified).toBe(false);
    // The refusal is local: nothing was ever sent to the backend.
    expect(bridge.packPreview).not.toHaveBeenCalled();
    // ...and it is visible outside the pack panel too, like the sibling save.
    expect(useApp.getState().status).toContain("couldn't load full data for every book");
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger")).toBe(true);
  });

  it("`Start pack` sends the FULL book too — the content reaching `pack_start` carries no `pending`", async () => {
    useApp.setState({ datasets: [lazyBook()], plotWindows: [], focusedWindowId: null });
    vi.mocked(fetchBookData).mockResolvedValue(fullRows);
    const manifest = okManifest();
    vi.mocked(bridge.packPreview).mockResolvedValue({
      ok: true,
      token: "tok-1",
      manifest,
      destination: { bundle_dir: "/dest/proj", exists: false },
      warnings: [],
      blockers: [],
    });
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });

    await usePackProject.getState().previewPackProject("/dest");
    await usePackProject.getState().startPackProject(manifest);
    stopPolling(); // the real 250ms interval has no business outliving this spec

    expect(vi.mocked(bridge.packStart)).toHaveBeenCalledTimes(1);
    const [, content] = vi.mocked(bridge.packStart).mock.calls[0];
    const packed = packedDataset(content, "lazy1");
    expect(packed.data).toEqual(fullRows);
    expect(packed).not.toHaveProperty("pending");
  });

  it("`Start pack` resolves too: a book added after the preview that cannot be fetched refuses by name, not as a stale preview", async () => {
    useApp.setState({
      datasets: [{ id: "a", name: "a.csv", data: fullRows }],
      plotWindows: [],
      focusedWindowId: null,
    });
    const manifest = okManifest();
    vi.mocked(bridge.packPreview).mockResolvedValue({
      ok: true,
      token: "tok-1",
      manifest,
      destination: { bundle_dir: "/dest/proj", exists: false },
      warnings: [],
      blockers: [],
    });
    await usePackProject.getState().previewPackProject("/dest");
    expect(usePackProject.getState().phase).toBe("awaiting_confirmation");

    // A lazy book lands between review and confirm (an import finishing) and
    // its source is already gone.
    useApp.setState({ datasets: [...useApp.getState().datasets, lazyBook("lazy2")] });
    vi.mocked(fetchBookData).mockRejectedValue(new Error("upload token expired"));

    await usePackProject.getState().startPackProject(manifest);

    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    // `pending_unresolved`, NOT `stale_preview`: without the resolve step the
    // preview rows would serialize cleanly and this would read as a mere
    // content change, hiding the dead book entirely.
    expect(s.errors[0].code).toBe("pending_unresolved");
    expect(s.errors[0].message).toContain("upload token expired");
    // Review finding #5: named, not just the operation + reason.
    expect(s.errors[0].message).toContain('"lazy2.opj"');
    expect(bridge.packStart).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger")).toBe(true);
  });

  it("cancelling while the book fetch is in flight is not overwritten when that fetch fails late", async () => {
    useApp.setState({ datasets: [lazyBook()], plotWindows: [], focusedWindowId: null });
    let failFetch: (e: Error) => void = () => {};
    vi.mocked(fetchBookData).mockReturnValue(
      new Promise((_resolve, reject) => {
        failFetch = reject;
      }),
    );

    const previewCall = usePackProject.getState().previewPackProject("/dest");
    // The resolve step is the THIRD await in this continuation, so it needs
    // the same generation guard the destination pick and `packPreview` have.
    await vi.waitFor(() => expect(usePackProject.getState().phase).toBe("scanning"));
    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");

    failFetch(new Error("moved or deleted"));
    await previewCall;

    expect(usePackProject.getState().phase).toBe("cancelled"); // not flipped to "failed"
    expect(usePackProject.getState().errors).toEqual([]);
    expect(bridge.packPreview).not.toHaveBeenCalled();
  });
});

// -- BUG-011 review round (2026-09-13): Start pack's OWN resolve window ----
//
// Finding #1: `runStartPackProject`'s book-resolve await had NO generation
// guard at all -- a cancel/reset DURING it was silently overwritten by
// whatever this continuation worked out afterward, exactly the bug the
// preview path (above) was already guarded against. Also closes nit 3: a
// second "Pack Project" click during the same window must not run a second
// concurrent attempt.
//
// Finding #2 (a book that goes pending DURING the resolve await) has no
// separate test file of its own -- `packProjectContent.ts` is exercised only
// through this file, same as `packProjectRun.ts` above it -- and is covered
// directly in the next describe block below.

describe("BUG-011 review — Start pack's own resolve window (finding #1, nit 3)", () => {
  const fullRows: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [[1], [2], [3], [4], [5], [9]],
    labels: ["m"],
    units: ["emu"],
    metadata: {},
  };

  function lateBook(id: string): Dataset {
    return {
      id,
      name: `${id}.opj`,
      data: { time: [0, 5], values: [[1], [9]], labels: ["m"], units: ["emu"], metadata: { lazy_preview: true } },
      pending: { kind: "path", path: `/${id}.opj`, bookId: "Book2", rows: 6, cols: 1 },
    };
  }

  beforeEach(() => {
    resetBookTransportForTests();
    useToasts.setState({ toasts: [] });
    vi.mocked(fetchBookData).mockReset();
  });

  afterEach(() => {
    stopPolling(); // a real 250ms interval must never outlive its own test
  });

  /** Reach `awaiting_confirmation` with dataset "a" only, then land a NEW
   *  lazy book -- "an import finished while the user was reviewing" -- so
   *  `startPackProject`'s OWN resolve step (not the preview's) has
   *  something to actually await. */
  async function readyWithLateBook(bookId: string): Promise<PortableManifest> {
    useApp.setState({
      datasets: [{ id: "a", name: "a.csv", data: fullRows }],
      plotWindows: [],
      focusedWindowId: null,
    });
    const manifest = await runToAwaitingConfirmation();
    useApp.setState({ datasets: [...useApp.getState().datasets, lateBook(bookId)] });
    return manifest;
  }

  it("resetting (the panel's Cancel) during a FAILING resolve is not overwritten by the late refusal", async () => {
    const manifest = await readyWithLateBook("late1");
    let failFetch: (e: Error) => void = () => {};
    vi.mocked(fetchBookData).mockReturnValue(
      new Promise((_resolve, reject) => {
        failFetch = reject;
      }),
    );

    const startCall = usePackProject.getState().startPackProject(manifest);
    await vi.waitFor(() => expect(useApp.getState().status).toContain("fetching"));

    await usePackProject.getState().resetPackProject();
    expect(usePackProject.getState().phase).toBe("idle");

    failFetch(new Error("moved or deleted")); // resolves LATE, after the reset already landed
    await startCall;

    expect(usePackProject.getState().phase).toBe("idle"); // not flipped to "failed"
    expect(usePackProject.getState().errors).toEqual([]);
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger")).toBe(false);
    expect(useApp.getState().status).not.toContain("pack failed");
  });

  it("resetting during a SUCCEEDING resolve is not overwritten by a late stale_preview", async () => {
    const manifest = await readyWithLateBook("late2");
    let resolveFetch: (d: DataStruct) => void = () => {};
    vi.mocked(fetchBookData).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const startCall = usePackProject.getState().startPackProject(manifest);
    await vi.waitFor(() => expect(useApp.getState().status).toContain("fetching"));

    await usePackProject.getState().resetPackProject();
    expect(usePackProject.getState().phase).toBe("idle");

    resolveFetch(fullRows); // resolves LATE, after the reset already landed
    await startCall;

    expect(usePackProject.getState().phase).toBe("idle"); // not flipped to "failed"/stale_preview
    expect(usePackProject.getState().errors).toEqual([]);
    expect(bridge.packStart).not.toHaveBeenCalled();
  });

  it("a second 'Pack Project' click during the resolve is rejected by the startInFlight guard (phase itself hasn't moved yet), not run as a second concurrent attempt", async () => {
    const manifest = await readyWithLateBook("late3");
    let resolveFetch: (d: DataStruct) => void = () => {};
    vi.mocked(fetchBookData).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const firstCall = usePackProject.getState().startPackProject(manifest);
    await vi.waitFor(() => expect(useApp.getState().status).toContain("fetching"));

    await usePackProject.getState().startPackProject(manifest); // second click, same manifest
    expect(usePackProject.getState().lastRejected).toEqual({ from: "awaiting_confirmation", action: "startPackProject" });
    expect(usePackProject.getState().phase).toBe("awaiting_confirmation"); // still mid-fetch, untouched

    resolveFetch(fullRows);
    await firstCall;
    // The late book changed the project's content since preview, so the
    // one real attempt ends in `stale_preview` -- the point here is that it
    // is the ONLY attempt that ever ran; a pre-fix double click ran both.
    expect(bridge.packStart).not.toHaveBeenCalled();
  });
});

// -- BUG-011 review round (2026-09-13): a book that turns pending again
// DURING the resolve await (finding #2) --------------------------------
//
// `resolvePendingDatasets()` only awaits what was pending when it was
// CALLED; a lazy import landing mid-await is never in that snapshot. Both
// entry points share the fix (`packProjectContent.ts`'s post-await
// re-check), so this is exercised once through the pack PREVIEW path.

describe("BUG-011 review — a book that goes pending DURING the resolve await (finding #2)", () => {
  const fullRows: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [[1], [2], [3], [4], [5], [9]],
    labels: ["m"],
    units: ["emu"],
    metadata: {},
  };

  function lazyBook(id: string): Dataset {
    return {
      id,
      name: `${id}.opj`,
      data: { time: [0, 5], values: [[1], [9]], labels: ["m"], units: ["emu"], metadata: { lazy_preview: true } },
      pending: { kind: "path", path: `/${id}.opj`, bookId: "Book2", rows: 6, cols: 1 },
    };
  }

  beforeEach(() => {
    resetBookTransportForTests();
    useToasts.setState({ toasts: [] });
    vi.mocked(fetchBookData).mockReset();
  });

  it("a dataset that becomes pending DURING the resolve await is refused, never serialized", async () => {
    useApp.setState({ datasets: [lazyBook("book1")], plotWindows: [], focusedWindowId: null });
    let resolveBook1: (d: DataStruct) => void = () => {};
    vi.mocked(fetchBookData).mockImplementation((source) => {
      if (source.path === "/book1.opj") {
        return new Promise((resolve) => {
          resolveBook1 = resolve;
        });
      }
      return Promise.resolve(fullRows);
    });

    const previewCall = usePackProject.getState().previewPackProject("/dest");
    await vi.waitFor(() => expect(useApp.getState().status).toContain("fetching"));

    // A second lazy book lands WHILE book1's fetch is still in flight --
    // `resolvePendingDatasets` (already called, already awaiting book1
    // alone) has no way to know book2 exists at all.
    useApp.setState({ datasets: [...useApp.getState().datasets, lazyBook("book2")] });

    resolveBook1(fullRows);
    await previewCall;

    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    expect(s.errors[0].code).toBe("pending_unresolved");
    // Round 2 nit 5: the refusal now names the book, not just "a book".
    expect(s.errors[0].message).toContain('"book2.opj" was still loading');
    // Nothing was ever sent to the bridge -- the payload string containing
    // book2's still-pending, still-decimated preview rows must never even
    // be BUILT, let alone reach `pack_preview`.
    expect(bridge.packPreview).not.toHaveBeenCalled();
  });
});

// -- BUG-011 round 2 (2026-09-13): `startInFlight` survives a fetch that ---
// never settles at all (finding #1) --------------------------------------
//
// `startPackProject`'s `finally` was the ONLY place the in-flight guard was
// ever cleared, and it never runs while the awaited `runStartPackProject`
// call is still pending -- a `fetchBookData` that never settles pinned the
// guard true forever, and neither Cancel nor Reset (a fresh preview
// included) could recover Start pack afterward. `resetStartInFlightForTests`
// exists ONLY so this file's own hooks can't leak a stuck guard between
// specs; it plays no part in the fix itself, which is the synchronous clear
// now in `resetPackProject`/`cancelPackProject` (store/packProject.ts).

describe("BUG-011 round 2 — startInFlight survives a fetch that never settles (finding #1)", () => {
  const fullRows: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [[1], [2], [3], [4], [5], [9]],
    labels: ["m"],
    units: ["emu"],
    metadata: {},
  };

  function lateBook(id: string): Dataset {
    return {
      id,
      name: `${id}.opj`,
      data: { time: [0, 5], values: [[1], [9]], labels: ["m"], units: ["emu"], metadata: { lazy_preview: true } },
      pending: { kind: "path", path: `/${id}.opj`, bookId: "Book2", rows: 6, cols: 1 },
    };
  }

  function plainDataset(): Dataset {
    return { id: "a", name: "a.csv", data: fullRows };
  }

  beforeEach(() => {
    resetBookTransportForTests();
    useToasts.setState({ toasts: [] });
    vi.mocked(fetchBookData).mockReset();
  });

  afterEach(() => {
    stopPolling();
  });

  it("probe P3: reset while the fetch is stuck forever, then a fresh preview + Start still reaches packStart", async () => {
    useApp.setState({ datasets: [plainDataset()], plotWindows: [], focusedWindowId: null });
    const manifest1 = await runToAwaitingConfirmation();
    useApp.setState({ datasets: [...useApp.getState().datasets, lateBook("stuck1")] });
    vi.mocked(fetchBookData).mockReturnValue(new Promise(() => {})); // never settles, ever

    // Fire-and-forget: this call's own promise is NEVER awaited, deliberately
    // -- the whole point of the probe is that recovery must not depend on it
    // ever resolving.
    const stuckStart = usePackProject.getState().startPackProject(manifest1);
    await vi.waitFor(() => expect(useApp.getState().status).toContain("fetching"));

    await usePackProject.getState().resetPackProject();
    expect(usePackProject.getState().phase).toBe("idle");

    // A brand-new preview with no pending book of its own, so IT never has
    // to await a fetch either -- isolates the assertion to the guard alone.
    useApp.setState({ datasets: [plainDataset()] });
    const manifest2 = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });

    await usePackProject.getState().startPackProject(manifest2);
    stopPolling(); // the real 250ms interval has no business outliving this spec

    expect(usePackProject.getState().lastRejected).toBeNull();
    expect(bridge.packStart).toHaveBeenCalledTimes(1);
    void stuckStart; // never settles in this spec; referenced only to avoid an unused-var lint error
  });

  it("cancelling a stuck Start also releases the guard, not only a reset", async () => {
    useApp.setState({ datasets: [plainDataset()], plotWindows: [], focusedWindowId: null });
    const manifest1 = await runToAwaitingConfirmation();
    useApp.setState({ datasets: [...useApp.getState().datasets, lateBook("stuck2")] });
    vi.mocked(fetchBookData).mockReturnValue(new Promise(() => {})); // never settles, ever

    const stuckStart = usePackProject.getState().startPackProject(manifest1);
    await vi.waitFor(() => expect(useApp.getState().status).toContain("fetching"));

    await usePackProject.getState().cancelPackProject();
    expect(usePackProject.getState().phase).toBe("cancelled");

    // A fresh preview straight from the terminal `cancelled` phase -- no
    // reset in between, and no pending book of its own.
    useApp.setState({ datasets: [plainDataset()] });
    const manifest2 = await runToAwaitingConfirmation();
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });

    await usePackProject.getState().startPackProject(manifest2);
    stopPolling();

    expect(usePackProject.getState().lastRejected).toBeNull();
    expect(bridge.packStart).toHaveBeenCalledTimes(1);
    void stuckStart;
  });
});

// -- BUG-011 round 2 (2026-09-13): the app status ends on a real outcome ---
// (finding N1/F3) ----------------------------------------------------------
//
// The transient "…packing…" `serializeCurrentWorkspaceForPack` sets while it
// fetches was never replaced once the real outcome was known -- lingering
// into `awaiting_confirmation` (the preview path, where nothing has been
// copied yet) or `completed` (the Start path, where the pack actually
// finished). Both callers now call `notePackOutcome` once they know better.

describe("BUG-011 round 2 — the app status ends on a real outcome, never mid-flight (finding N1/F3)", () => {
  const fullRows: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [[1], [2], [3], [4], [5], [9]],
    labels: ["m"],
    units: ["emu"],
    metadata: {},
  };

  function lazyBook(id: string): Dataset {
    return {
      id,
      name: `${id}.opj`,
      data: { time: [0, 5], values: [[1], [9]], labels: ["m"], units: ["emu"], metadata: { lazy_preview: true } },
      pending: { kind: "path", path: `/${id}.opj`, bookId: "Book2", rows: 6, cols: 1 },
    };
  }

  beforeEach(() => {
    resetBookTransportForTests();
    useToasts.setState({ toasts: [] });
    vi.mocked(fetchBookData).mockReset();
  });

  it("the pack preview never leaves the app status reading '…packing…' once it is ready to review", async () => {
    useApp.setState({ datasets: [lazyBook("statusbook1")], plotWindows: [], focusedWindowId: null });
    vi.mocked(fetchBookData).mockResolvedValue(fullRows);
    vi.mocked(bridge.packPreview).mockResolvedValue({
      ok: true,
      token: "tok-1",
      manifest: okManifest(),
      destination: { bundle_dir: "/dest/proj", exists: false },
      warnings: [],
      blockers: [],
    });

    await usePackProject.getState().previewPackProject("/dest");

    expect(usePackProject.getState().phase).toBe("awaiting_confirmation");
    expect(useApp.getState().status).not.toContain("packing");
    expect(useApp.getState().status).toContain("review the pack preview");
  });

  it("a completed Start pack ends the app status on the actual outcome, not the fetch transient", async () => {
    vi.useFakeTimers();
    useApp.setState({ datasets: [lazyBook("statusbook2")], plotWindows: [], focusedWindowId: null });
    vi.mocked(fetchBookData).mockResolvedValue(fullRows);
    const manifest = okManifest();
    vi.mocked(bridge.packPreview).mockResolvedValue({
      ok: true,
      token: "tok-1",
      manifest,
      destination: { bundle_dir: "/dest/proj", exists: false },
      warnings: [],
      blockers: [],
    });
    await usePackProject.getState().previewPackProject("/dest");
    // After the preview's own resolve, the book is no longer pending, so
    // Start's own resolve step below finds nothing left to fetch.
    vi.mocked(bridge.packStart).mockResolvedValue({ ok: true });
    await usePackProject.getState().startPackProject(manifest);
    expect(usePackProject.getState().phase).toBe("packing");

    vi.mocked(bridge.packStatus).mockResolvedValueOnce(
      statusOf({ phase: "completed", result: { bundle_dir: "/dest/proj" }, cleanup_ok: null }),
    );
    await vi.advanceTimersByTimeAsync(250);

    expect(usePackProject.getState().phase).toBe("completed");
    expect(useApp.getState().status).not.toContain("packing");
    expect(useApp.getState().status).toContain("/dest/proj");
  });
});

// -- BUG-011 round 2 (2026-09-13): the refusal's reason stays paired with ---
// its OWN book (finding #5) -------------------------------------------------
//
// Round 1's fix used `lastBookError` only to pick WHICH book to name, but
// still quoted the raw thrown `e` as the reason -- so a still-pending
// dataset with a STALE recorded error (from an earlier attempt; a fetch
// failure never clears `pending`, and `_bookErrors` is cleared only on
// success) could be named alongside a completely different book's reason,
// whenever it sorted earlier in `datasets` order than whichever book
// actually caused THIS rejection.

describe("BUG-011 round 2 — the refusal's reason stays paired with its own book (finding #5)", () => {
  function lazyBook(id: string, name: string): Dataset {
    return {
      id,
      name,
      data: { time: [0, 5], values: [[1], [9]], labels: ["m"], units: ["emu"], metadata: { lazy_preview: true } },
      pending: { kind: "path", path: `/${id}.opj`, bookId: id, rows: 6, cols: 1 },
    };
  }

  beforeEach(() => {
    resetBookTransportForTests();
    useToasts.setState({ toasts: [] });
    vi.mocked(fetchBookData).mockReset();
  });

  it("P4c: a second attempt names the book its OWN recorded reason belongs to, never a different book's error text", async () => {
    const bookA = lazyBook("bookA", "bookA.opj");
    useApp.setState({ datasets: [bookA], plotWindows: [], focusedWindowId: null });

    // Attempt 1: bookA fails outright, recording its own reason.
    vi.mocked(fetchBookData).mockRejectedValueOnce(new Error("A is gone"));
    await usePackProject.getState().previewPackProject("/dest");
    expect(usePackProject.getState().errors[0].message).toContain('"bookA.opj" — A is gone');

    // Attempt 2, from the terminal `failed` phase (a fresh preview is legal
    // there, no explicit reset needed): bookA is STILL pending (a fetch
    // failure never clears it) and is re-fetched, but this time never
    // settles; a NEW book, bookB, is also pending and fails FAST, so
    // `Promise.all` rejects with B's rejection while bookA's OWN recorded
    // reason is still the stale "A is gone" from attempt 1.
    const bookB = lazyBook("bookB", "bookB.opj");
    useApp.setState({ datasets: [bookA, bookB] });
    vi.mocked(fetchBookData).mockImplementation((source) =>
      source.path === "/bookA.opj" ? new Promise(() => {}) : Promise.reject(new Error("B expired")),
    );

    await usePackProject.getState().previewPackProject("/dest");

    const s = usePackProject.getState();
    expect(s.phase).toBe("failed");
    // Named book and quoted reason are BOTH about bookA -- never bookA's
    // name paired with bookB's "B expired" text (the pre-fix bug).
    expect(s.errors[0].message).toContain('"bookA.opj" — A is gone');
    expect(s.errors[0].message).not.toContain("B expired");
  });
});
