// P2.5 "Metadata → factors" workshop: opened from the Data menu and the
// Library row menu on the selection; the promotion is previewed per dataset
// (missing values named, blank) before "Add factor column"; the cleanup lists
// the keys with coverage, previews every change and every refusal, and writes
// nothing until Apply. The Reshape workshop's append offers the source column.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDataCommands } from "../../../commands/dataCommands";
import { buildDatasetRowMenu } from "../../Library/datasetRowMenu";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useMetaFactorsDialog } from "../../../store/metaFactorsDialog";
import { useApp } from "../../../store/useApp";
import { formToRun, seedForm } from "../transformPreview/transformForm";
import MetaFactorsPanel from "./MetaFactorsPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const data = (metadata: Record<string, unknown>): DataStruct => ({
  time: [0, 1],
  values: [[1], [2]],
  labels: ["M"],
  units: ["emu"],
  metadata,
});
const A: Dataset = { id: "a", name: "a.dat", data: data({ sample: "S1", Temp: "300 K" }) };
const B: Dataset = { id: "b", name: "b.dat", data: data({ sample: "S2", T_set: "27 C" }) };
const C: Dataset = { id: "c", name: "c.dat", data: data({ instrument: { SAMPLE_MASS: "7.2" } }) };

beforeEach(() => {
  useMetaFactorsDialog.setState({ seed: null, opened: 0 });
  useApp.setState({
    datasets: [A, B, C],
    folders: [],
    activeId: "a",
    selectedIds: ["a", "b"],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
  });
});

const byId = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;
const open = () => act(() => buildDataCommands(useApp.getState).find((c) => c.id === "meta-factors")!.run());

describe("opening", () => {
  it("the Data command and the Library row menu open on the selection", () => {
    open();
    expect(useMetaFactorsDialog.getState().seed).toEqual(["a", "b"]);
    const menu = buildDatasetRowMenu(C, false, false, [], false, false, () => {}, () => {});
    act(() => menu.find((i) => i.label === "Metadata → factors…")!.run!());
    expect(useMetaFactorsDialog.getState().seed).toEqual(["c"]); // a row outside the selection: just that row
    const inSel = buildDatasetRowMenu(A, true, true, [], false, false, () => {}, () => {});
    act(() => inSel.find((i) => i.label === "Metadata → factors…")!.run!());
    expect(useMetaFactorsDialog.getState().seed).toEqual(["a", "b"]);
  });
});

describe("promote", () => {
  it("previews each dataset's value, names the missing one, and adds the column on commit", async () => {
    open();
    render(<MetaFactorsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "c.dat" }));
    expect(screen.getByRole("combobox", { name: "Metadata field" })).toHaveValue(JSON.stringify(["sample"]));
    const rows = within(screen.getByRole("table", { name: "Factor preview" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(["a.datS1", "b.datS2", "c.dat(blank — no value)"]);
    expect(screen.getByRole("note").textContent).toBe("No value in c.dat: its rows are left blank, not filled in.");
    expect(byId("a").data.labels).toEqual(["M"]); // nothing written by the preview

    fireEvent.click(screen.getByRole("button", { name: "Add factor column" }));
    await waitFor(() => expect(byId("a").data.labels).toEqual(["M", "sample"]));
    expect(byId("b").data.cat_levels?.[1]).toEqual(["S2"]);
    expect(byId("c").data.values.every((r) => Number.isNaN(r[1]))).toBe(true);
    expect(useApp.getState().macroSteps.map((s) => s.params.op)).toEqual(["promote"]);
  });

  it("an instrument sidecar field promotes as numeric; the override and a name clash are honoured", async () => {
    act(() => useMetaFactorsDialog.setState({ seed: ["c"], opened: 1 }));
    render(<MetaFactorsPanel />);
    expect(screen.getByRole("combobox", { name: "Column type" })).toHaveDisplayValue("Automatic (numeric)");
    fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "m" } });
    expect(screen.getByText(/already has a column named “m”/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add factor column" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "mass" } });
    fireEvent.click(screen.getByRole("button", { name: "Add factor column" }));
    await waitFor(() => expect(byId("c").data.labels).toEqual(["M", "mass"]));
    expect(byId("c").data.values.map((r) => r[1])).toEqual([7.2, 7.2]);
  });
});

describe("clean up", () => {
  it("lists keys with coverage, previews a synonym merge and the refused unit parse, writes only on Apply", async () => {
    open();
    render(<MetaFactorsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Clean up metadata" }));
    const keys = within(screen.getByRole("table", { name: "Metadata keys" })).getAllByRole("row").slice(1);
    expect(keys.map((r) => r.textContent)).toEqual(["sample2/2", "T_set1/2 — not in a.dat", "Temp1/2 — not in b.dat"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Merge Temp" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Merge T_set" }));
    fireEvent.change(screen.getByLabelText("Merge the ticked keys into"), { target: { value: "temperature" } });
    fireEvent.click(screen.getByRole("button", { name: "Add merge" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Key to normalize" }), { target: { value: "temperature" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Parse number + unit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add normalize" }));

    const preview = within(screen.getByRole("table", { name: "Cleanup preview" })).getAllByRole("row").slice(1);
    expect(preview.map((r) => r.textContent)).toEqual([
      "a.dattemperature—300 K",
      "a.datTemp300 K(removed — renamed to temperature)",
      "b.dattemperature—27 C",
      "b.datT_set27 C(removed — renamed to temperature)",
    ]);
    expect(screen.getByRole("list", { name: "Refused" }).textContent).toBe("temperature: the units differ (K, C) — units not parsed.");
    expect(byId("a").data.metadata).toEqual(A.data.metadata);

    fireEvent.click(screen.getByRole("button", { name: "Apply 4 changes" }));
    await waitFor(() => expect(byId("a").data.metadata.temperature).toBe("300 K"));
    expect("Temp" in byId("a").data.metadata).toBe(false);
    expect(byId("b").data.metadata.temperature).toBe("27 C");
    act(() => useApp.getState().undo());
    expect(byId("a").data.metadata).toEqual(A.data.metadata);
  });
});

describe("Reshape append: source column option", () => {
  it("adds sourceFactor to the merge params only when ticked and named", () => {
    const f = seedForm("merge", ["a", "b"], [A, B]);
    const run = (patch: object) => formToRun({ ...f, ...patch }, [A, B]);
    expect(run({})).toMatchObject({ params: { op: "merge" } });
    expect((run({}) as { params: object }).params).not.toHaveProperty("sourceFactor");
    expect(run({ sourceOn: true })).toMatchObject({ params: { op: "merge", sourceFactor: "source" } });
    expect(run({ sourceOn: true, sourceName: " " })).toBe("Name the source column.");
  });
});
