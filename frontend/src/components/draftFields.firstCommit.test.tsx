// Forced first-commit race for every text-draft field that used to resync its draft in a mount-time effect
// (the class #1228 found in the Column list). Each test types into the field in the microtask right after the
// component's first commit, before React runs that commit's passive effects, then checks the typed text survived.
// See test/firstCommit.tsx for how the window is hit on every run.

import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { actOnFirstCommit, settle } from "../test/firstCommit";
import { useApp } from "../store/useApp";
import { useAnnotationTextDialog } from "../store/annotationTextDialog";
import type { Dataset } from "../lib/types";
import AnnotationTextDialog from "./overlays/AnnotationTextDialog";
import NotesCard from "./Inspector/NotesCard";
import RichLabelInput from "./primitives/RichLabelInput";
import { WindowLayoutPref } from "./overlays/WindowLayoutPref";
import FitParamTable from "./workshops/reflectivity/FitParamTable";
import GradedListField from "./workshops/reflectivity/GradedListField";
import type { FitParamRow } from "./workshops/reflectivity/reflFitModel";

const q =
  <T extends HTMLElement>(sel: string) =>
  () =>
    document.querySelector<T>(sel);
let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

describe("RichLabelInput: text typed on the first committed frame", () => {
  it("survives, and Enter commits it", async () => {
    const onCommit = vi.fn();
    const m = await actOnFirstCommit(
      <RichLabelInput value="Old" name="Title" onCommit={onCommit} />,
      q<HTMLInputElement>('input[aria-label="Title"]'),
      (el) => fireEvent.change(el, { target: { value: "Typed" } }),
    );
    unmount = m.unmount;
    await settle();
    const el = document.querySelector<HTMLInputElement>('input[aria-label="Title"]')!;
    expect(el.value).toBe("Typed");
    fireEvent.keyDown(el, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Typed");
  });

  it("still follows the prop when it changes elsewhere", async () => {
    const m = await actOnFirstCommit(<RichLabelInput value="Old" name="Title" onCommit={() => {}} />, q<HTMLInputElement>('input[aria-label="Title"]'), () => {});
    unmount = m.unmount;
    await settle();
    m.root.render(<RichLabelInput value="New" name="Title" onCommit={() => {}} />);
    await settle();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Title"]')!.value).toBe("New");
  });
});

describe("NotesCard: notes typed on the first committed frame", () => {
  const ds: Dataset = {
    id: "n1",
    name: "n.dat",
    notes: "old notes",
    data: { time: [1], values: [[1]], labels: ["M"], units: ["emu"], metadata: {} },
  };
  beforeEach(() => useApp.setState({ datasets: [ds], activeId: "n1" }));

  it("survive and commit on blur", async () => {
    const m = await actOnFirstCommit(<NotesCard active={ds} />, q<HTMLTextAreaElement>('textarea[aria-label="Dataset notes"]'), (el) =>
      fireEvent.change(el, { target: { value: "typed notes" } }),
    );
    unmount = m.unmount;
    await settle();
    const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Dataset notes"]')!;
    expect(el.value).toBe("typed notes");
    fireEvent.blur(el);
    expect(useApp.getState().datasets[0].notes).toBe("typed notes");
  });
});

describe("AnnotationTextDialog: first open of the (lazy) panel", () => {
  const open = (title: string, initial: string) => useAnnotationTextDialog.setState({ title, initial, resolve: null });
  afterEach(() => useAnnotationTextDialog.setState({ title: null, initial: "", resolve: null }));

  it("shows the initial text on the first frame, so an immediate Enter keeps it", async () => {
    const resolve = vi.fn();
    useAnnotationTextDialog.setState({ title: "Edit annotation text", initial: "Tc", resolve });
    const m = await actOnFirstCommit(<AnnotationTextDialog />, q<HTMLInputElement>('[role="dialog"] input'), (el) => {
      expect(el.value).toBe("Tc");
      fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: "Enter" });
    });
    unmount = m.unmount;
    expect(resolve).toHaveBeenCalledWith("Tc");
  });

  it("keeps text typed on the first frame and resolves with it", async () => {
    const resolve = vi.fn();
    useAnnotationTextDialog.setState({ title: "Edit annotation text", initial: "Tc", resolve });
    const m = await actOnFirstCommit(<AnnotationTextDialog />, q<HTMLInputElement>('[role="dialog"] input'), (el) =>
      fireEvent.change(el, { target: { value: "Typed" } }),
    );
    unmount = m.unmount;
    await settle();
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe("Typed");
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: "Enter" });
    expect(resolve).toHaveBeenCalledWith("Typed");
  });

  it("re-seeds when the dialog is asked again with new text", async () => {
    useAnnotationTextDialog.setState({ title: "Edit", initial: "A", resolve: null });
    const m = await actOnFirstCommit(<AnnotationTextDialog />, q<HTMLInputElement>('[role="dialog"] input'), () => {});
    unmount = m.unmount;
    await settle();
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe("A");
    open("Edit", "B");
    await settle();
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe("B");
  });
});

describe("Window layout pref: tile width typed on the first committed frame", () => {
  beforeEach(() => useApp.setState({ layoutMode: "windows", layoutTileBelow: 1280 }));

  it("an out-of-range width stays visible next to its message", async () => {
    const sel = 'input[aria-label="Tile below width (px)"]';
    const m = await actOnFirstCommit(<WindowLayoutPref />, q<HTMLInputElement>(sel), (el) => fireEvent.change(el, { target: { value: "50" } }));
    unmount = m.unmount;
    await settle();
    expect(document.querySelector<HTMLInputElement>(sel)!.value).toBe("50");
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/600 to 3,840/);
    expect(useApp.getState().layoutTileBelow).toBe(1280);
  });
});

describe("Fit parameter table: a partial number typed on the first committed frame", () => {
  const row = { name: "L1 thickness", value: 100, vary: true, min: 0, max: 500, tie: "", layer: 1, field: "thickness" } as FitParamRow;

  it("is kept (it does not parse yet, so nothing was committed)", async () => {
    const onChange = vi.fn();
    const sel = 'input[aria-label="L1 thickness value"]';
    const m = await actOnFirstCommit(<FitParamTable rows={[row]} onChange={onChange} />, q<HTMLInputElement>(sel), (el) =>
      fireEvent.change(el, { target: { value: "1e" } }),
    );
    unmount = m.unmount;
    await settle();
    expect(document.querySelector<HTMLInputElement>(sel)!.value).toBe("1e");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Graded layer list field: an unparseable draft typed on the first committed frame", () => {
  it("stays a local draft with its message", async () => {
    const onCommit = vi.fn();
    const sel = 'input[aria-label="SLD knots"]';
    const field = (
      <GradedListField<number[]>
        label="SLD"
        name="SLD knots"
        title="t"
        value={[1, 2]}
        format={(v) => v.join(", ")}
        parse={(t) => {
          const n = t.split(",").map((s) => Number(s));
          return n.length > 0 && n.every(Number.isFinite) ? n : null;
        }}
        onCommit={onCommit}
        invalid="Not a list of numbers."
      />
    );
    const m = await actOnFirstCommit(field, q<HTMLInputElement>(sel), (inp) => fireEvent.change(inp, { target: { value: "1, x" } }));
    unmount = m.unmount;
    await settle();
    expect(document.querySelector<HTMLInputElement>(sel)!.value).toBe("1, x");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Not a list of numbers.");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
