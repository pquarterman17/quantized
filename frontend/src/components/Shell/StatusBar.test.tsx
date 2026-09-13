import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StatusBar from "./StatusBar";
import { HEALTHY } from "../../lib/autosaveGenerations";
import { useConnection } from "../../lib/lifecycle";
import { exportFigure } from "../../lib/api/figures";
import { runExportFigureCommand } from "../../lib/exportFigureCommand";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { beginOp, endOp, updateOp, usePendingOps } from "../../store/pendingOps";
import { useApp } from "../../store/useApp";

vi.mock("../../lib/api/figures", () => ({ exportFigure: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({
    fmt: "pdf",
    style: "default",
    dpi: 300,
    title: "",
    x_label: "",
    y_label: "",
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  useApp.setState({ status: "ready", datasets: [], activeId: null });
  useConnection.setState({ connected: true });
  useAutosaveStatus.setState({ health: HEALTHY });
  usePendingOps.setState({ ops: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StatusBar pending-op indicator (P3.4 slice 2)", () => {
  it("does not show a fresh op immediately (age-gate)", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    expect(screen.queryByText("Export figure…")).not.toBeInTheDocument();
  });

  it("shows an op's label once it has been pending past the age-gate", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
  });

  it("hides again once the op completes", () => {
    render(<StatusBar />);
    let id = -1;
    act(() => {
      id = beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
    act(() => {
      endOp(id);
    });
    expect(screen.queryByText("Export figure…")).not.toBeInTheDocument();
  });

  it('shows "and N more" once multiple ops are past the gate', () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
      beginOp("Export Origin (.ogs)…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText(/Export figure…/)).toBeInTheDocument();
    expect(screen.getByText(/\+1 more/)).toBeInTheDocument();
  });

  it("the autosave-failing banner keeps precedence — still renders alongside a pending op", () => {
    useAutosaveStatus.setState({ health: { savedAt: null, error: "disk full", count: 0 } });
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("autosave failing");
  });

  it("the autosave-failing banner still renders with no pending ops (unweakened baseline)", () => {
    useAutosaveStatus.setState({ health: { savedAt: null, error: "disk full", count: 0 } });
    render(<StatusBar />);
    expect(screen.getByRole("alert")).toHaveTextContent("autosave failing");
  });
});

describe("StatusBar pending-op live region (accessibility gap)", () => {
  // A screen-reader user gets no indication the P3.4 progress feed exists or
  // changes at all without an ARIA live region on the pending-op list itself
  // (only the Cancel button had a label before this). Progress should not
  // interrupt whatever the user is doing — `polite`, not `alert` — so this is
  // deliberately `role="status"`/`aria-live="polite"`, distinct from the
  // `role="alert"` autosave-failure banner covered above. Queried by the
  // `.qzk-pending` class (not `getByRole("status", {name})`) because "status"
  // is a name-from-author role — content alone isn't a reliable accessible
  // name, so the real fix must not depend on one either.
  function pendingRegion(): Element | null {
    return document.querySelector(".qzk-pending");
  }

  // REVIEW ROUND. The live region must already EXIST while idle. A region
  // inserted into the DOM in the same commit as its first text is commonly not
  // announced at all by screen readers — so a conditionally-rendered region
  // loses the first announcement, which for a short operation is the only one.
  // The class-based queries above cannot see this: `.qzk-pending` is still
  // absent while idle (only the class is dropped, not the element), so this
  // asserts on the region itself.
  it("keeps the live region mounted while idle, so the first op is announced", () => {
    render(<StatusBar />);
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe(""); // present, but announcing nothing yet
  });

  it("exposes the pending-op indicator as a polite live region", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const region = pendingRegion();
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region!.textContent).toContain("Export figure…");
  });

  it("announces the updated label (not just the initial one) as an op's progress changes", () => {
    render(<StatusBar />);
    let id = -1;
    act(() => {
      id = beginOp("Importing 1/19: a.dat…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(pendingRegion()!.textContent).toContain("Importing 1/19");
    act(() => {
      updateOp(id, "Importing 2/19: b.dat…");
    });
    expect(pendingRegion()!.textContent).toContain("Importing 2/19");
    expect(pendingRegion()!.textContent).not.toContain("Importing 1/19");
  });

  it("does not render a status live region when nothing is pending", () => {
    render(<StatusBar />);
    expect(pendingRegion()).toBeNull();
  });
});

describe("StatusBar cancel affordance (P3.4 slice 1)", () => {
  it("renders no Cancel control for an op with no cancel callback", () => {
    render(<StatusBar />);
    act(() => {
      beginOp("Export figure…");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Export figure…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("renders a Cancel control for an op that carries one, and clicking it calls cancel", () => {
    const cancel = vi.fn();
    render(<StatusBar />);
    act(() => {
      beginOp("Importing scan.dat…", cancel);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const btn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(btn);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("shows Cancel for only the first (oldest) op when several are pending", () => {
    const cancelA = vi.fn();
    const cancelB = vi.fn();
    render(<StatusBar />);
    act(() => {
      beginOp("Importing a.dat…", cancelA);
      beginOp("Importing b.dat…", cancelB);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelA).toHaveBeenCalledOnce();
    expect(cancelB).not.toHaveBeenCalled();
  });
});

// PRIMARY_SOFTWARE_AUDIT_PLAN P3.4 (safe cancel for long export operations):
// end-to-end DOM coverage — a REAL "Export figure…" invocation (not a
// synthetic beginOp() call like the generic tests above) renders its Cancel
// control in StatusBar, and clicking it actually aborts the in-flight
// request. The mechanism itself (label, cancel-detection, no-download-on-
// cancel) is unit-tested in lib/exportActive.test.ts and
// lib/exportFigureCommand.test.ts; this is the "does it actually reach the
// screen" check.
describe("StatusBar × export cancel (P3.4 safe-cancel-for-export)", () => {
  beforeEach(() => {
    // Real timers for this block: the age-gate poll (PENDING_OP_POLL_MS)
    // needs to actually elapse, and the op is registered after several real
    // microtask awaits (askParams, exportActive's resolveDataset) rather
    // than synchronously — fake timers would need pumping through every one
    // of those for no real benefit. The file-level afterEach's
    // vi.useRealTimers() already restores this after every test either way.
    vi.useRealTimers();
    vi.mocked(exportFigure).mockReset();
    usePendingOps.setState({ ops: [] });
    useApp.setState({
      status: "",
      datasets: [
        {
          id: "d1",
          name: "scan.dat",
          data: { time: [0, 1], values: [[1, 2]], labels: ["A"], units: [""], metadata: {} },
        },
      ],
      activeId: "d1",
      xKey: null,
      yKeys: null,
      y2Keys: null,
      xScale: "linear",
      yScale: "linear",
      xFmt: { mode: "auto", digits: 2 },
      yFmt: { mode: "auto", digits: 2 },
      y2Fmt: null,
      xStep: null,
      yStep: null,
      seriesStyles: {},
      seriesLabels: {},
      seriesOrder: null,
      hiddenChannels: [],
      xLim: null,
      yLim: null,
      showGrid: true,
      showAxisBox: false,
      plotTitle: "",
      xAxisLabel: "",
      yAxisLabel: "",
    });
  });

  it("shows the export op with a Cancel control, and clicking it aborts the request", async () => {
    let capturedSignal: AbortSignal | undefined;
    let rejectExport!: (e: unknown) => void;
    vi.mocked(exportFigure).mockImplementation((_body, signal) => {
      capturedSignal = signal;
      return new Promise((_r, rj) => (rejectExport = rj));
    });

    render(<StatusBar />);
    const p = runExportFigureCommand(useApp.getState);

    // Real timers here (unlike the beginOp()-driven tests above): the age
    // gate is wall-clock, and this op is registered through several real
    // awaits (askParams, exportActive's resolveDataset) rather than
    // synchronously, so fake timers would need to be pumped through every
    // microtask in between for no real benefit.
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" }, { timeout: 2000 });
    expect(screen.getByText("Exporting scan.dat…")).toBeInTheDocument();
    expect(capturedSignal?.aborted).toBe(false);

    fireEvent.click(cancelBtn);
    expect(capturedSignal?.aborted).toBe(true);

    rejectExport(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await p;

    expect(useApp.getState().status).toBe("export cancelled");
    await vi.waitFor(() => expect(screen.queryByText("Exporting scan.dat…")).not.toBeInTheDocument());
  });
});
