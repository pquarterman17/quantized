import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import QuickFigureBuilderWorkspace from "./QuickFigureBuilderWorkspace";

const dataset: Dataset = {
  id: "d1",
  name: "measurement.csv",
  data: {
    time: [0, 1, 2],
    values: [[2, 3], [4, 5], [6, 7]],
    labels: ["signal", "error"],
    units: ["V", "V"],
    metadata: {},
  },
};

// G4 review round, FIX 2: a dataset with a worksheet-level (Inspector
// Channels-card) role on a channel that is NOT auto-inferred as an error
// column, so it starts out ignored by `initialQuickFigureMapping` and can be
// explicitly reassigned to Y through the builder's own role menu (which is
// agnostic of `channelRoles` -- see quickFigurePreview.ts's FIX 2 comment).
const roleDataset: Dataset = {
  id: "d2",
  name: "roled.csv",
  data: {
    time: [0, 1, 2],
    values: [[2, 30], [4, 40], [6, 50]],
    labels: ["signal", "flagged"],
    units: ["V", "V"],
    metadata: {},
  },
  channelRoles: { 1: "ignore" },
};

const asymmetricDataset: Dataset = {
  id: "d3",
  name: "asymmetric.csv",
  data: {
    time: [0, 1, 2],
    values: [[2, 0.2, 0.3], [4, 0.4, 0.5], [6, 0.6, 0.7]],
    labels: ["signal", "signal_err+", "signal_err-"],
    units: ["V", "V", "V"],
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [dataset],
    quickFigureBuilderDatasetId: "d1",
    editableFigures: [],
    plotWindows: [],
    cmdkOpen: false,
  });
});

describe("QuickFigureBuilderWorkspace — G1 shell", () => {
  it("shows the source facts without creating or mutating a figure", () => {
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.getByRole("heading", { name: "Configure measurement.csv" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for signal" })).toBeInTheDocument();
    // The fixture's default mapping already assigns "signal" to Y (see the
    // "offers keyboard-accessible..." test below), so the button starts
    // enabled -- mappingReady-gated, not the old unconditional disable.
    expect(screen.getByRole("button", { name: "Create Editable Figure" })).not.toBeDisabled();
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  // G4: the old unconditional `disabled` pin is now mappingReady-gated —
  // disabled the moment Y assignment drops to zero, enabled the moment one
  // is (re)assigned. Carries the factual "why" as its title (L0.36: disabled
  // WITH a reason, never hidden).
  it("gates Create Editable Figure on mappingReady — disabled with zero Y series, enabled once a Y is assigned", () => {
    render(<QuickFigureBuilderWorkspace />);
    const createBtn = screen.getByRole("button", { name: "Create Editable Figure" });
    expect(createBtn).not.toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Role for signal" }), { target: { value: "ignore" } });
    expect(createBtn).toBeDisabled();
    expect(createBtn).toHaveAttribute("title", "Assign at least one Y series to create a figure");

    fireEvent.change(screen.getByRole("combobox", { name: "Role for signal" }), { target: { value: "y" } });
    expect(createBtn).not.toBeDisabled();
    expect(createBtn).not.toHaveAttribute("title");
  });

  // G4: the live wiring — a successful commit creates exactly ONE figure and
  // ONE window (the canonical FigureDocument lifecycle, mirroring
  // quickPlotDataset's shape — see store/quickFigureCreate.ts), and the
  // builder closes (quickFigureBuilderDatasetId -> null) so Stage reappears.
  it("click creates exactly one figure + one window and the builder closes", () => {
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));

    const { editableFigures, plotWindows, quickFigureBuilderDatasetId } = useApp.getState();
    expect(editableFigures).toHaveLength(1);
    expect(editableFigures[0].name).toBe("Quick Figure — measurement.csv");
    expect(plotWindows).toHaveLength(1);
    expect(plotWindows[0].document?.id).toBe(editableFigures[0].id);
    expect(quickFigureBuilderDatasetId).toBeNull();
  });

  // G4: "mutate first, close only on success" — a false return (a vanished
  // dataset mid-click; the store action's own fail-closed gate is covered by
  // store/quickFigureCreate.test.ts) must create nothing and leave the
  // builder open. Stubbing the action directly isolates the WORKSPACE'S own
  // contract from the store's reason for refusing.
  it("click with a vanished dataset creates nothing and does not close", () => {
    const realAction = useApp.getState().createQuickFigureFromMapping;
    useApp.setState({ createQuickFigureFromMapping: () => false });
    try {
      render(<QuickFigureBuilderWorkspace />);
      fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));

      const { editableFigures, plotWindows, quickFigureBuilderDatasetId } = useApp.getState();
      expect(editableFigures).toEqual([]);
      expect(plotWindows).toEqual([]);
      expect(quickFigureBuilderDatasetId).toBe("d1");
    } finally {
      useApp.setState({ createQuickFigureFromMapping: realAction });
    }
  });

  // G4 review round, FIX 2 (RED-FIRST): the created figure drops a channel
  // carrying a worksheet-level Label/Ignore role even when explicitly
  // assigned to Y (effectiveChannels filters it, quickFigureCommit does
  // not) -- L0.36 requires a visible reason rather than a silently
  // mismatched preview.
  it("shows a hint when a Label/Ignore-role channel is explicitly assigned to Y", () => {
    useApp.setState({ datasets: [roleDataset], quickFigureBuilderDatasetId: "d2" });
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Role for flagged" }), { target: { value: "y" } });

    expect(screen.getByRole("status")).toHaveTextContent(
      '"flagged" is marked Label/Ignore in this worksheet and won\'t appear on the created figure',
    );
  });

  it("blocks creation for a role-filtered Y until the worksheet role is cleared", () => {
    useApp.setState({ datasets: [roleDataset], quickFigureBuilderDatasetId: "d2" });
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.change(screen.getByRole("combobox", { name: "Role for flagged" }), { target: { value: "y" } });
    const createBtn = screen.getByRole("button", { name: "Create Editable Figure" });
    expect(createBtn).toBeDisabled();
    expect(createBtn).toHaveAttribute("title", "Clear the Label/Ignore role from every assigned Y column in the Channels card first");
    expect(createBtn).toHaveAttribute("aria-describedby", "quick-builder-role-warning");

    act(() => useApp.setState({ datasets: [{ ...roleDataset, channelRoles: undefined }] }));
    expect(createBtn).not.toBeDisabled();
    fireEvent.click(createBtn);
    expect(useApp.getState().editableFigures).toHaveLength(1);
  });

  it("identifies and blocks a half-complete asymmetric error pair", () => {
    useApp.setState({ datasets: [asymmetricDataset], quickFigureBuilderDatasetId: "d3" });
    render(<QuickFigureBuilderWorkspace />);
    const minus = screen.getByRole("combobox", { name: "Role for signal_err-" });
    fireEvent.change(minus, { target: { value: "unassigned" } });

    expect(screen.getByRole("status")).toHaveTextContent('Y error for "signal" has + "signal_err+" but is missing −');
    const createBtn = screen.getByRole("button", { name: "Create Editable Figure" });
    expect(createBtn).toBeDisabled();
    expect(createBtn).toHaveAttribute("title", 'Y error for "signal" has + "signal_err+" but is missing −');
    expect(createBtn).toHaveAttribute("aria-describedby", "quick-builder-error-warning");

    fireEvent.change(minus, { target: { value: "error:y:0:-" } });
    expect(createBtn).not.toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers keyboard-accessible X, Y, ignore, and targeted error roles", () => {
    render(<QuickFigureBuilderWorkspace />);
    const signal = screen.getByRole("combobox", { name: "Role for signal" });
    const error = screen.getByRole("combobox", { name: "Role for error" });
    expect(signal).toHaveValue("y");
    fireEvent.change(signal, { target: { value: "x" } });
    expect(signal).toHaveValue("x");
    fireEvent.change(error, { target: { value: "error:x:-1:both" } });
    expect(error).toHaveValue("error:x:-1:both");
    fireEvent.change(error, { target: { value: "y" } });
    expect(screen.getByText("1 Y series against signal")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Plot style" }), { target: { value: "line-symbol" } });
    expect(screen.getByRole("combobox", { name: "Plot style" })).toHaveValue("line-symbol");
  });

  it("supports dragging a column into an explicit role zone", () => {
    render(<QuickFigureBuilderWorkspace />);
    const values = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const row = screen.getByText("signal").closest("li")!;
    const ignoreZone = screen.getByLabelText("Column role drop zones").querySelectorAll(".qzk-quick-builder-zone")[2];
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.drop(ignoreZone, { dataTransfer });
    expect(screen.getByRole("combobox", { name: "Role for signal" })).toHaveValue("ignore");
  });

  it("Cancel clears only the transient builder target", () => {
    const datasetsBefore = useApp.getState().datasets;
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
    expect(useApp.getState().datasets).toBe(datasetsBefore);
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  it("Escape cancels, but the command palette owns Escape while open", () => {
    render(<QuickFigureBuilderWorkspace />);
    useApp.setState({ cmdkOpen: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().quickFigureBuilderDatasetId).toBe("d1");
    useApp.setState({ cmdkOpen: false });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
  });

  it("Escape cancels, but a context menu owns Escape while open", () => {
    render(<QuickFigureBuilderWorkspace />);
    const ctx = document.createElement("div");
    ctx.className = "qzk-ctx";
    document.body.appendChild(ctx);
    try {
      fireEvent.keyDown(window, { key: "Escape" });
      expect(useApp.getState().quickFigureBuilderDatasetId).toBe("d1");
    } finally {
      document.body.removeChild(ctx);
    }
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
  });

  it("degrades honestly if the source disappears while open", () => {
    useApp.setState({ datasets: [] });
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.getByRole("heading", { name: "Worksheet unavailable" })).toBeInTheDocument();
    expect(screen.getByText("The source worksheet was removed. Nothing was changed.")).toBeInTheDocument();
  });
});
