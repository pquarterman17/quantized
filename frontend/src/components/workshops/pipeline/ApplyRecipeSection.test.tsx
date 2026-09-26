// P2.5 box 4 through the Pipeline workshop's Templates section: save the
// recorded steps as a transformation recipe (description, revision, expected
// input), then Apply… it — each picked dataset's preflight and column
// bindings show BEFORE anything runs, a refused one is not applied, a
// rebinding makes it ready, and Apply creates the derived outputs.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TemplatesSection from "./TemplatesSection";
import type { RecipeProvenance } from "./runTemplate";
import { loadTemplates } from "../../../lib/template";
import { runTransform } from "../../../lib/transformRun";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const ds = (id: string, labels: string[], units: string[]): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1, 2, 3], [4, 5, 6]], labels, units, metadata: {} },
});
const SRC = ds("src", ["key", "T", "v"], ["", "K", "emu"]);
const OTHER = ds("other", ["key", "Temp", "v"], ["", "K", "emu"]);

beforeEach(async () => {
  localStorage.clear();
  useApp.setState({
    datasets: [SRC, OTHER],
    folders: [],
    activeId: "src",
    selectedIds: ["src"],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
    history: [],
    future: [],
  });
  // Record two transforms on src: stack(T, v), then transpose its output.
  const s1 = await runTransform(useApp.getState, { op: "stack", channels: [1, 2] }, "src");
  await runTransform(useApp.getState, { op: "transpose" }, s1!.id);
  useApp.setState({ macroRecording: false, activeId: "src", selectedIds: ["src"], history: [] });
});

async function saveAs(name: string, description: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Template name" }), { target: { value: name } });
  fireEvent.change(screen.getByRole("textbox", { name: "Recipe description" }), { target: { value: description } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Template name" })).toHaveValue(""));
}

describe("save a transformation recipe", () => {
  it("records the description, the expected input read off the recording, and a revision per save", async () => {
    render(<TemplatesSection />);
    expect(screen.getByRole("combobox", { name: "Example dataset" })).toHaveValue("src");
    expect(screen.getByRole("note", { name: "Expected input" })).toHaveTextContent("Expects: columns T (K), v (emu)");
    await saveAs("two steps", "stack then transpose");
    let [t] = loadTemplates();
    expect(t).toMatchObject({ name: "two steps", description: "stack then transpose", revision: 1 });
    expect(t.expects?.columns.map((c) => [c.name, c.unit, c.required])).toEqual([["key", "", false], ["T", "K", true], ["v", "emu", true]]);
    await saveAs("two steps", "");
    [t] = loadTemplates();
    expect(t.revision).toBe(2);
    expect(t.description).toBeUndefined();
  });
});

describe("apply a saved recipe", () => {
  it("previews each pick's preflight, refuses until rebound, then applies with provenance", async () => {
    render(<TemplatesSection />);
    await saveAs("two steps", "");
    fireEvent.change(screen.getByRole("combobox", { name: "Saved template" }), { target: { value: "two steps" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply…" }));
    const region = screen.getByRole("region", { name: "Apply recipe two steps" });
    expect(region).toHaveTextContent("2 steps");

    // Pick "other" instead of src: its T is named "Temp", so it is refused.
    fireEvent.click(within(region).getByRole("checkbox", { name: "src.dat" }));
    fireEvent.click(within(region).getByRole("checkbox", { name: "other.dat" }));
    const group = within(region).getByRole("group", { name: "Preflight other.dat" });
    expect(group).toHaveTextContent("other.dat — refused");
    expect(within(group).getByRole("list", { name: "Issues for other.dat" })).toHaveTextContent("no column “T” (K)");
    const apply = within(region).getByRole("button", { name: "Apply to 0 datasets" });
    expect(apply).toBeDisabled();
    const before = useApp.getState().datasets.length;

    // Rebind T → Temp: ready.
    fireEvent.change(within(group).getByRole("combobox", { name: "Bind T in other.dat" }), { target: { value: "1" } });
    expect(group).toHaveTextContent("other.dat — ready");
    fireEvent.click(within(region).getByRole("button", { name: "Apply to 1 dataset" }));

    const results = await within(region).findByRole("list", { name: "Apply results" });
    expect(results).toHaveTextContent("other.dat: created");
    const s = useApp.getState();
    const out = s.datasets.find((d) => d.data.metadata.transform_recipe)!;
    expect(out.data.metadata.transform_recipe).toMatchObject({
      recipe: "two steps",
      revision: 1,
      input: { id: "other", name: "other.dat" },
      bindings: [{ column: "key", from: "key" }, { column: "T", from: "Temp" }, { column: "v", from: "v" }],
    } satisfies Partial<RecipeProvenance>);
    expect(s.datasets.length).toBe(before + 2);
    expect(s.history.map((h) => h.label)).toEqual(["apply recipe “two steps”"]);
  });

  it("a unit mismatch holds Apply until acknowledged", async () => {
    useApp.setState({ datasets: [...useApp.getState().datasets, ds("mk", ["key", "T", "v"], ["", "mK", "emu"])], selectedIds: ["mk"] });
    render(<TemplatesSection />);
    await saveAs("two steps", "");
    fireEvent.change(screen.getByRole("combobox", { name: "Saved template" }), { target: { value: "two steps" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply…" }));
    const region = screen.getByRole("region", { name: "Apply recipe two steps" });
    expect(within(region).getByRole("group", { name: "Preflight mk.dat" })).toHaveTextContent("in mK");
    expect(within(region).getByRole("button", { name: "Apply to 0 datasets" })).toBeDisabled();
    fireEvent.click(within(region).getByRole("checkbox", { name: "Apply despite the unit mismatch" }));
    expect(within(region).getByRole("button", { name: "Apply to 1 dataset" })).toBeEnabled();
  });
});
