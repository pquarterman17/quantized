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

describe("SplitDatasetDialog — invalid tolerance text (bug-hunt regression: preview/commit parity)", () => {
  // Previously: the preview memo fell back to `undefined` (auto) for
  // invalid tolerance text, but `runSplit` passed the raw `Number(text)`
  // through unguarded — "abc" (NaN) previewed the auto-tolerance groups but
  // committed as ONE group (NaN never flushes a cluster boundary); "-5"
  // previewed the same but committed as one-row-per-value garbage (a
  // negative tolerance splits even exact-duplicate rows). Both are fixed by
  // resolving ONE tolerance value shared by the preview memo and the commit
  // call, and disabling Confirm outright for invalid non-empty text.

  it("non-numeric tolerance text previews the AUTO groups (not 1) and disables Confirm", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.change(screen.getByLabelText("Tolerance"), { target: { value: "abc" } });
    // Preview still shows the auto-tolerance 2-group result, not "1 group".
    expect(screen.getByText("5 K")).toBeInTheDocument();
    expect(screen.getByText("10 K")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: /Split into/ });
    expect(confirm).toBeDisabled();
  });

  it("negative tolerance text previews the AUTO groups (not one-row-per-value) and disables Confirm", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.change(screen.getByLabelText("Tolerance"), { target: { value: "-5" } });
    expect(screen.getByText("5 K")).toBeInTheDocument();
    expect(screen.getByText("10 K")).toBeInTheDocument();
    expect(screen.queryByText("Split into 6 datasets")).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: /Split into/ });
    expect(confirm).toBeDisabled();
  });

  it("clicking Confirm while disabled by invalid text is a true no-op (no commit, dialog stays open)", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    fireEvent.change(screen.getByLabelText("Tolerance"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /Split into/ }));
    expect(useApp.getState().datasets).toHaveLength(1); // no children minted
    expect(useApp.getState().splitDialogTargetId).toBe("d1"); // dialog still open
  });

  it("fixing invalid text back to a valid number re-enables Confirm", () => {
    useApp.setState({ splitDialogTargetId: "d1" });
    render(<SplitDatasetDialog />);
    const field = screen.getByLabelText("Tolerance");
    fireEvent.change(field, { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: /Split into/ })).toBeDisabled();
    fireEvent.change(field, { target: { value: "0.5" } });
    expect(screen.getByRole("button", { name: /Split into/ })).not.toBeDisabled();
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

// BUG-008: the dialog's tolerance field is the user-visible tell. It is shown
// only for a CONTINUOUS column, and `isCategoricalColumn` used to answer that
// from the raw shape heuristic alone — so a 6-row column with an explicit
// level table was offered a tolerance (i.e. told the user it was a continuous
// measurement) and previewed as ONE group.
describe("SplitDatasetDialog — an explicit cat_levels table (BUG-008)", () => {
  const samples: DataStruct = {
    time: [1, 2, 3, 4, 5, 6],
    values: [[0], [1], [2], [0], [1], [2]],
    labels: ["sample"],
    units: [""],
    metadata: {},
    cat_levels: { 0: ["A123", "B456", "C789"] },
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run1.dat", data: samples }],
      splitDialogTargetId: "d1",
    });
  });

  it("hides the tolerance field (the column is categorical, not a measurement)", () => {
    render(<SplitDatasetDialog />);
    expect(screen.queryByLabelText("Tolerance")).toBeNull();
  });

  it("previews one group per LEVEL NAME, not one merged group", () => {
    render(<SplitDatasetDialog />);
    expect(screen.getByText("A123")).toBeInTheDocument();
    expect(screen.getByText("B456")).toBeInTheDocument();
    expect(screen.getByText("C789")).toBeInTheDocument();
    expect(screen.getAllByText("2 rows")).toHaveLength(3);
    expect(screen.getByText("Split into 3 datasets")).toBeInTheDocument();
  });

  // A malformed level table with two identical names is the one realistic way
  // two groups can share a LABEL. They must still be two groups (the codes
  // differ), and the preview list must not collapse or warn — which is why it
  // keys on `g.value`, the distinct grouping key, rather than the label.
  it("keeps duplicate level NAMES as separate groups in the preview", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run1.dat",
          data: { ...samples, cat_levels: { 0: ["dup", "dup", "C789"] } },
        },
      ],
    });
    render(<SplitDatasetDialog />);
    expect(screen.getByText("Split into 3 datasets")).toBeInTheDocument();
    expect(screen.getAllByText("dup")).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled(); // no duplicate-key warning
    warn.mockRestore();
  });

  // MEDIUM 5 of the review round. The default column is now frequently the
  // categorical one, whose tolerance field is hidden — so the seeded tolerance
  // came from dimensionless level codes and was then presented, unchanged, as
  // a distance in the next column's physical units.
  it("re-seeds the tolerance from the NEW column when the column changes", () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run1.dat",
          data: {
            time: [0, 1, 2, 3, 4, 5],
            // channel 0: a named categorical column (the default pick);
            // channel 1: a physical field sweep in T.
            values: [
              [0, 1.0],
              [1, 2.5],
              [2, 4.1],
              [0, 5.9],
              [1, 7.4],
              [2, 9.2],
            ],
            labels: ["sample", "field"],
            units: ["", "T"],
            metadata: {},
            cat_levels: { 0: ["A123", "B456", "C789"] },
          },
        },
      ],
    });
    render(<SplitDatasetDialog />);
    // Opens on the categorical column: no tolerance field at all.
    expect(screen.queryByLabelText("Tolerance")).toBeNull();

    fireEvent.change(screen.getByLabelText("Split column"), { target: { value: "1" } });

    // Pre-fix this arrived as "1" — autoTolerance over the codes [0,1,2] —
    // and previewed six one-row groups. The field column's own autoTolerance
    // is 1.8, which previews as ONE group ("nothing to split").
    // MEASURED, not rounded: the field is seeded with `String(autoTolerance(
    // ...))`, and this column's elbow tolerance carries float noise. The exact
    // string matters because the dialog deliberately previews and commits the
    // SAME resolved number, so a prettier display here would have to be a
    // parse-back, not a reformat. The point of the assertion is the SCALE —
    // ~1.8 T from the field column, not 1 from the level codes.
    expect((screen.getByLabelText("Tolerance") as HTMLInputElement).value).toBe("1.8000000000000007");
    expect(screen.getByText(/Only one group detected \(6 rows\)/)).toBeInTheDocument();
  });

  // MEDIUM 3: the over-cap advice used to say "widen the tolerance" for a
  // column whose tolerance field this very component hides — impossible
  // advice, and newly reachable because a >8-distinct level-table column now
  // goes to exact-value grouping instead of gap-clustering.
  it("does not tell the user to widen a tolerance field it is hiding", () => {
    const n = 120;
    const levels = Array.from({ length: 60 }, (_, i) => `L${i}`);
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run1.dat",
          data: {
            time: Array.from({ length: n }, (_, i) => i),
            values: Array.from({ length: n }, (_, i) => [i % 60]),
            labels: ["sample"],
            units: [""],
            metadata: {},
            cat_levels: { 0: levels },
          },
        },
      ],
    });
    render(<SplitDatasetDialog />);
    expect(screen.queryByLabelText("Tolerance")).toBeNull();
    expect(screen.getByText(/60 groups detected/)).toBeInTheDocument();
    expect(screen.getByText(/use Recode… to combine levels first/)).toBeInTheDocument();
    expect(screen.queryByText(/widen the tolerance/)).toBeNull();
  });

  // HIGH 1 of the ROUND-2 review: the MEDIUM 5 fix above reintroduced, for the
  // x column, the very defect it set out to fix. `-1` is a first-class option
  // in the Select, but the copied `col < 0 ? "0"` guard meant picking it seeded
  // tolerance 0 — and 0 splits every distinct x value into its own group.
  it("seeds the tolerance from the x column when x is picked", () => {
    // A PPMS-shaped x: 4 setpoints, 5 wobble reads each.
    const time: number[] = [];
    for (const sp of [5, 10, 50, 100]) for (let i = 0; i < 5; i++) time.push(sp + i * 0.001);
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run1.dat",
          data: {
            time,
            values: time.map((_, i) => [i * 2]),
            labels: ["M"],
            units: ["emu"],
            metadata: {},
          },
        },
      ],
    });
    render(<SplitDatasetDialog />);
    fireEvent.change(screen.getByLabelText("Split column"), { target: { value: "-1" } });

    // Pre-fix: value "0", 20 one-row groups, and Confirm ENABLED — so this
    // committed 20 singleton datasets. The x column's own autoTolerance is
    // ~0.0707, which recovers the 4 real setpoints.
    expect((screen.getByLabelText("Tolerance") as HTMLInputElement).value).not.toBe("0");
    expect(screen.getByText("Split into 4 datasets")).toBeInTheDocument();
  });

  // MEDIUM 4 of the round-2 review: the categorical branch of the over-cap
  // advice was asserted, the CONTINUOUS one was not — so collapsing both
  // branches to the Recode wording left the suite green (measured 23/23). This
  // is that missing positive control.
  it("still tells the user to widen the tolerance for a continuous column", () => {
    // 60 setpoints x 3 wobble reads. A UNIFORM ramp will not do: its gaps are
    // homogeneous, so `autoTolerance` falls to the largest gap and merges
    // everything into ONE group (measured while writing this test). A bimodal
    // wobble/jump structure is what makes `autoTolerance` find a real elbow
    // and produce 60 clusters — over the cap of 50, and CONTINUOUS, so the
    // tolerance field is showing.
    const field: number[] = [];
    for (let sp = 0; sp < 60; sp++) for (let i = 0; i < 3; i++) field.push(sp + i * 0.001);
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run1.dat",
          data: {
            time: field.map((_, i) => i),
            values: field.map((v) => [v]),
            labels: ["field"],
            units: ["T"],
            metadata: {},
          },
        },
      ],
    });
    render(<SplitDatasetDialog />);
    expect(screen.getByText(/too many to split at once/)).toBeInTheDocument();
    expect(screen.getByText(/widen the tolerance/)).toBeInTheDocument();
    expect(screen.queryByText(/use Recode…/)).toBeNull();
    // And the field it points at is actually there for this column.
    expect(screen.getByLabelText("Tolerance")).toBeInTheDocument();
  });

  // The continuous fixture at the top of this file still gets its tolerance
  // field — the positive control that the fix didn't hide it for everyone.
  it("still shows the tolerance field for a continuous column", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run1.dat", data: wobble }] });
    render(<SplitDatasetDialog />);
    expect(screen.getByLabelText("Tolerance")).toBeInTheDocument();
  });
});

describe("Analyze-menu/⌘K command registry entry (MAIN_PLAN #26)", () => {
  // commands/dataCommands.ts's curated actions array IS (part of) the
  // command registry (MenuBar and the ⌘K palette both consume the
  // aggregated appCommands.ts) — the same source-scan pattern
  // TextFormatHelp.test.tsx uses for the identical reason (the App tree is
  // too heavy to render in jsdom). Split moved here from appCommands.ts
  // when that module was decomposed by menu domain (2026-07-17). The
  // overlay mount lives in AppOverlays.tsx.
  const commandsSrc = Object.values(
    import.meta.glob("../../commands/dataCommands.ts", { query: "?raw", import: "default", eager: true }),
  )[0] as string;
  const overlaysSrc = Object.values(
    import.meta.glob("../../AppOverlays.tsx", { query: "?raw", import: "default", eager: true }),
  )[0] as string;

  it("commands/dataCommands.ts registers the Split command in the Data group, acting on the active dataset", () => {
    expect(commandsSrc).toContain('id: "split"');
    expect(commandsSrc).toContain('group: "Data"');
    expect(commandsSrc).toContain('label: "Split by column value…"');
    expect(commandsSrc).toContain("openSplitDialog(id)");
  });

  it("AppOverlays.tsx mounts the dialog", () => {
    expect(overlaysSrc).toContain("<SplitDatasetDialog />");
  });
});
