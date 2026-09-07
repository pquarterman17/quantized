// PackProjectPanel — smoke + wiring, the RelinkPanel.test.tsx pattern: seed
// the store's phase/preview/progress state and check the view reflects it,
// then spy on the store actions (via `setState`, no bridge needed) to check
// the panel's controls call the right ones. Two behaviors specific to this
// panel get their own tests: the open/idle mount-time race (PackProjectPanel
// must not close itself just because it hasn't yet seen a non-idle phase),
// and `dismiss()`'s per-phase close semantics.

import { act, render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortableManifest } from "../../../lib/desktopPackBridge";
import { EMPTY_PACK_PROGRESS, usePackProject } from "../../../store/packProject";
import { usePackProjectPanel } from "../../../store/packProjectPanel";
import PackProjectPanel from "./PackProjectPanel";

const fakeAppState = {
  toolWindowLayout: {},
  setToolWindowLayout: vi.fn(),
  toggleToolWindowCollapsed: vi.fn(),
};
function useAppMock<T>(selector: (s: typeof fakeAppState) => T): T {
  return selector(fakeAppState);
}
useAppMock.getState = () => fakeAppState;
vi.mock("../../../store/useApp", () => ({ useApp: useAppMock }));

function fakeManifest(overrides: Partial<PortableManifest> = {}): PortableManifest {
  return {
    format: "quantized-portable",
    manifest_version: 1,
    dry_run: true,
    project: {
      name: "demo",
      project_file: "demo.dwk",
      workspace_format: null,
      workspace_version: null,
      renamed_from: null,
    },
    layout: { manifest_file: "manifest.json", sources_dir: "sources" },
    sources: [
      {
        source_id: "s1",
        original_path: "/data/a.csv",
        original_path_variants: [],
        bundle_path: "sources/a.csv",
        status: "ok",
        size: 2048,
        mtime: null,
        checksum: null,
        shared: false,
        shared_by: [],
        changed: false,
        unverified: false,
        packable: true,
        blockers: [],
        warnings: [],
        collision_group: null,
        renamed_from: null,
      },
    ],
    datasets: [],
    warnings: [],
    summary: { datasets: 1, sources: 1, packable: 1, blocked: 0, shared: 0, total_bytes: 2048, warnings: 0 },
    ...overrides,
  };
}

function fakePreview(overrides: Partial<PortableManifest> = {}) {
  return {
    token: "t1",
    manifest: fakeManifest(overrides),
    destination: { bundleDir: "/dest/demo-portable", exists: false },
    warnings: [],
    blockers: [],
    content: "{}",
    destinationParent: "/dest",
    projectName: "demo",
  };
}

beforeEach(() => {
  usePackProjectPanel.setState({ open: true });
  usePackProject.setState({
    phase: "idle",
    progress: EMPTY_PACK_PROGRESS,
    warnings: [],
    errors: [],
    resultPath: null,
    cleanupOk: null,
    preview: null,
    lastRejected: null,
    startPackProject: vi.fn(),
    cancelPackProject: vi.fn().mockResolvedValue(undefined),
    resetPackProject: vi.fn().mockResolvedValue(undefined),
    previewPackProject: vi.fn(),
  });
});

describe("PackProjectPanel — phase rendering", () => {
  it("renders the selecting_destination status", () => {
    usePackProject.setState({ phase: "selecting_destination" });
    render(<PackProjectPanel />);
    expect(screen.getByText("Choose where to create the portable project.")).toBeInTheDocument();
  });

  it("renders the scanning status", () => {
    usePackProject.setState({ phase: "scanning" });
    render(<PackProjectPanel />);
    expect(screen.getByText("Checking source files…")).toBeInTheDocument();
  });

  it("renders the awaiting_confirmation review with the preview's contents", () => {
    usePackProject.setState({ phase: "awaiting_confirmation", preview: fakePreview() });
    render(<PackProjectPanel />);
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText("/dest/demo-portable")).toBeInTheDocument();
    expect(screen.getByText(/1 datasets · 1 source files · 2\.0 KiB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pack Project" })).toBeEnabled();
  });

  it("disables Pack Project when the destination already exists", () => {
    usePackProject.setState({
      phase: "awaiting_confirmation",
      preview: { ...fakePreview(), destination: { bundleDir: "/dest/demo-portable", exists: true } },
    });
    render(<PackProjectPanel />);
    expect(screen.getByRole("button", { name: "Pack Project" })).toBeDisabled();
  });

  it("says blocked sources keep their original absolute paths in the packed copy", () => {
    const preview = fakePreview();
    usePackProject.setState({
      phase: "awaiting_confirmation",
      preview: { ...preview, blockers: [preview.manifest.sources[0]] },
    });
    render(<PackProjectPanel />);
    expect(screen.getByText(/keep their original absolute paths in the packed copy/)).toBeInTheDocument();
  });

  it("renders packing progress", () => {
    usePackProject.setState({
      phase: "packing",
      progress: { currentFile: "a.csv", completedCount: 1, totalCount: 3, bytesCopied: 1024, bytesTotal: 4096, stage: "copying" },
    });
    render(<PackProjectPanel />);
    expect(screen.getByText("copying…")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 files · 1.0 KiB of 4.0 KiB")).toBeInTheDocument();
  });

  it("renders the cancelling status", () => {
    usePackProject.setState({ phase: "cancelling" });
    render(<PackProjectPanel />);
    expect(screen.getByText("Stopping safely…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("renders the completed result", () => {
    usePackProject.setState({ phase: "completed", resultPath: "/dest/demo-portable" });
    render(<PackProjectPanel />);
    expect(screen.getByText("Portable project created")).toBeInTheDocument();
    expect(screen.getByText("/dest/demo-portable")).toBeInTheDocument();
  });

  it("renders the cancelled result", () => {
    usePackProject.setState({ phase: "cancelled" });
    render(<PackProjectPanel />);
    expect(screen.getByText("Pack cancelled")).toBeInTheDocument();
  });

  it("renders the failed result with its errors", () => {
    usePackProject.setState({
      phase: "failed",
      errors: [{ code: "e1", message: "disk full", originalsModified: false, note: "" }],
    });
    render(<PackProjectPanel />);
    expect(screen.getByText("Could not pack project")).toBeInTheDocument();
    expect(screen.getByText("disk full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("PackProjectPanel — open/idle mount-time race", () => {
  // The forcing test the module comment promises: mount while idle (as if
  // opened by runPackProject just before previewPackProject moves the
  // phase) and the panel flag must NOT be closed just because it hasn't yet
  // seen a non-idle phase.
  it("forces the mount-time idle race: stays open at idle-on-mount, then closes on a LATER return to idle", () => {
    usePackProject.setState({ phase: "idle" });
    render(<PackProjectPanel />);
    expect(usePackProjectPanel.getState().open).toBe(true);

    act(() => usePackProject.setState({ phase: "selecting_destination" }));
    expect(usePackProjectPanel.getState().open).toBe(true);

    act(() => usePackProject.setState({ phase: "idle" }));
    expect(usePackProjectPanel.getState().open).toBe(false);
  });
});

describe("PackProjectPanel — dismiss()", () => {
  it("review-step Cancel resets straight to idle (never via the cancelled screen) and closes the panel flag", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    usePackProject.setState({
      phase: "awaiting_confirmation",
      preview: fakePreview(),
      cancelPackProject: cancel,
      resetPackProject: reset,
    });
    render(<PackProjectPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(reset).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(usePackProjectPanel.getState().open).toBe(false);
  });

  it("'Try again' from failed re-runs the preview (not a reset)", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    usePackProject.setState({
      phase: "failed",
      errors: [{ code: "x", message: "boom", originalsModified: false, note: "" }],
      previewPackProject: retry,
      resetPackProject: reset,
    });
    render(<PackProjectPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(retry).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });

  it("Cancel while scanning resets straight to idle and closes the panel flag", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    usePackProject.setState({ phase: "scanning", cancelPackProject: cancel, resetPackProject: reset });
    usePackProjectPanel.setState({ open: true });
    render(<PackProjectPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(reset).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(usePackProjectPanel.getState().open).toBe(false);
  });

  it("the X button at idle closes the panel without touching the store", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    usePackProject.setState({ phase: "idle", cancelPackProject: cancel, resetPackProject: reset });
    usePackProjectPanel.setState({ open: true });
    render(<PackProjectPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close/i }));
    });
    expect(usePackProjectPanel.getState().open).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("a terminal Close resets and closes the panel flag (never calls cancel)", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    usePackProject.setState({ phase: "completed", resultPath: "/dest/demo", cancelPackProject: cancel, resetPackProject: reset });
    render(<PackProjectPanel />);
    // ToolWindow's own X button also has accessible name "Close" (via its
    // `title` attribute) — getByText targets the visible-text Close button
    // this phase renders, not that unrelated X.
    await act(async () => {
      fireEvent.click(screen.getByText("Close"));
    });
    expect(reset).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(usePackProjectPanel.getState().open).toBe(false);
  });

  it("the X button while packing cancels but leaves the panel open (equivalent to the Cancel button)", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn().mockResolvedValue(undefined);
    usePackProject.setState({
      phase: "packing",
      progress: { ...EMPTY_PACK_PROGRESS, totalCount: 3 },
      cancelPackProject: cancel,
      resetPackProject: reset,
    });
    render(<PackProjectPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTitle("Close"));
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    expect(usePackProjectPanel.getState().open).toBe(true);
  });
});
