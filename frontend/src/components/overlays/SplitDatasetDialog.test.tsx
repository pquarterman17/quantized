import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import SplitDatasetDialog from "./SplitDatasetDialog";

vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));

// Two setpoints (5 K / 10 K), each with small wobble — <12 rows so
// lib/modeling.ts's inferModelingType always reads "continuous" (see
// store/split.test.ts's identical fixture doc).
const wobble: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[4.998], [5.0], [5.003], [9.997], [10.0], [10.003]],
  labels: ["T"],
  units: ["K"],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "run1.dat", data: wobble }],
    folders: [],
    expandedFolders: [],
    activeId: "d1",
    selectedIds: ["d1"],
    worksheetId: null,
    history: [],
    future: [],
    splitDialogTargetId: null,
  });
});

describe("SplitDatasetDialog — visibility", () => {
  it("renders nothing when no dialog target is set", () => {
    const { container } = render(<SplitDatasetDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing if the target dataset id no longer exists", () => {
    useApp.setState({ splitDialogTargetId: "ghost" });
    const { container } = render(<SplitDatasetDialog />);
    expect(container.firstChild).toBeNull();
  });
});

describe("SplitDatasetDialog — live preview", () => {
  it("shows the auto-detected groups (value -> row count) as soon as it opens", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    expect(screen.getByText("5 K")).toBeInTheDocument();
    expect(screen.getByText("10 K")).toBeInTheDocument();
    expect(screen.getAllByText("3 rows")).toHaveLength(2);
    expect(screen.getByText("Split into 2 datasets")).toBeInTheDocument();
  });

  it("recomputes the preview live when the tolerance is widened to merge everything", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.change(screen.getByLabelText("Tolerance"), { target: { value: "100" } });
    expect(screen.getByText(/Only one group detected/)).toBeInTheDocument();
    expect(screen.queryByText("5 K")).not.toBeInTheDocument();
  });

  it("recomputes the preview live when the tolerance is tightened to split every row", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.change(screen.getByLabelText("Tolerance"), { target: { value: "0" } });
    // 6 distinct wobble reads, tolerance 0 -> 6 singleton groups.
    expect(screen.getByText("Split into 6 datasets")).toBeInTheDocument();
  });

  it("switching to a categorical column hides the tolerance field but still previews correctly", () => {
    // 14 rows so lib/modeling.ts's inferModelingType (MIN_SAMPLES=12) actually
    // reads the "run" column as nominal instead of falling back to continuous.
    const temps = [4.997, 4.998, 4.999, 5.0, 5.001, 5.002, 5.003, 9.997, 9.998, 9.999, 10.0, 10.001, 10.002, 10.003];
    const runId = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2];
    const data: DataStruct = {
      time: temps.map((_, i) => i),
      values: temps.map((t, i) => [t, runId[i]]),
      labels: ["T", "run"],
      units: ["K", ""],
      metadata: {},
    };
    useApp.setState({ datasets: [{ id: "d1", name: "run1.dat", data }], splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    expect(screen.getByLabelText("Tolerance")).toBeInTheDocument(); // default column ("T") is continuous
    fireEvent.change(screen.getByLabelText("Split column"), { target: { value: "1" } });
    // The "run" column is exact-value (no tolerance shown) -> still 2 groups.
    expect(screen.queryByLabelText("Tolerance")).not.toBeInTheDocument();
    expect(screen.getByText("Split into 2 datasets")).toBeInTheDocument();
  });
});

describe("SplitDatasetDialog — the >cap warning path", () => {
  it("shows a warning instead of a list when the group count exceeds the cap", () => {
    const n = 60;
    const ramp: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [i]),
      labels: ["x"],
      units: [""],
      metadata: {},
    };
    useApp.setState({ datasets: [{ id: "d1", name: "sweep.dat", data: ramp }], splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.change(screen.getByLabelText("Tolerance"), { target: { value: "0.5" } });
    expect(screen.getByText(/too many to split at once/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Split into/ })).toBeDisabled();
  });
});

describe("SplitDatasetDialog — confirm / cancel", () => {
  it("Cancel closes without calling splitDatasetByColumn", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(useApp.getState().splitDialogTargetId).toBeNull();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("Escape closes without splitting", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().splitDialogTargetId).toBeNull();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("Confirm splits the active preview and closes", async () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.click(screen.getByText("Split into 2 datasets"));
    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(useApp.getState().splitDialogTargetId).toBeNull();
  });

  it("Confirm is disabled (a no-op) when only one group is detected", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "flat.dat", data: { ...wobble, values: wobble.values.map(() => [5]) } }],
      splitDialogTargetId: "d1",
    });
    render(<SplitDatasetDialog />);
    const confirm = screen.getByRole("button", { name: /Split into/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

describe("Analyze-menu/⌘K command registry entry (MAIN_PLAN #26)", () => {
  // appCommands.ts's curated actions array IS the command registry (MenuBar
  // and the ⌘K palette both consume it) — the same source-scan pattern
  // TextFormatHelp.test.tsx uses for the identical reason (the App tree is
  // too heavy to render in jsdom). The overlay mount lives in AppOverlays.tsx.
  const commandsSrc = Object.values(
    import.meta.glob("../../appCommands.ts", { query: "?raw", import: "default", eager: true }),
  )[0] as string;
  const overlaysSrc = Object.values(
    import.meta.glob("../../AppOverlays.tsx", { query: "?raw", import: "default", eager: true }),
  )[0] as string;

  it("appCommands.ts registers the Split command in the Data group, acting on the active dataset", () => {
    expect(commandsSrc).toContain('id: "split"');
    expect(commandsSrc).toContain('group: "Data"');
    expect(commandsSrc).toContain('label: "Split by column value…"');
    expect(commandsSrc).toContain("openSplitDialog(id)");
  });

  it("AppOverlays.tsx mounts the dialog", () => {
    expect(overlaysSrc).toContain("<SplitDatasetDialog />");
  });
});
