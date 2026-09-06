// P1.7 "Pack Project" PR 4 state machine (store/packProject.ts +
// store/packProjectRun.ts). `../lib/desktopPackBridge` is mocked wholesale
// (the relink.test.ts precedent) so every scenario is driven by controlled
// bridge responses rather than a real pywebview window.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as bridge from "../lib/desktopPackBridge";
import type { PackStatus, PortableManifest } from "../lib/desktopPackBridge";
import {
  EMPTY_PACK_PROGRESS,
  usePackProject,
  type PackProjectPhase,
  type PackProjectState,
} from "./packProject";
import { resetThrottle, scheduleStatusApply, stopPolling } from "./packProjectRun";
import { useApp } from "./useApp";

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
});

afterEach(() => {
  stopPolling();
  resetThrottle();
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
      expect(s.phase).toBe("idle"); // bridge unavailable -> picker "cancel" -> idle
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
    if (TERMINAL.includes(phase)) {
      expect(s.lastRejected).toBeNull();
      expect(s.phase).toBe("idle");
      expect(s.preview).toBeNull();
    } else {
      expect(s.lastRejected).toEqual({ from: phase, action: "resetPackProject" });
      expect(s.phase).toBe(phase);
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
