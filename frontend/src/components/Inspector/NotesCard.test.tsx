import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import NotesCard from "./NotesCard";

const sample: DataStruct = {
  time: [1, 2],
  values: [[10], [20]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};
const d1: Dataset = { id: "d1", name: "scan.dat", data: sample };
const d2: Dataset = { id: "d2", name: "scan2.dat", data: sample };

beforeEach(() => {
  useApp.setState({ datasets: [d1], activeId: "d1" });
});

describe("NotesCard", () => {
  it("renders nothing without an active dataset", () => {
    const { container } = render(<NotesCard active={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("commits the draft to the store only on blur (not per keystroke)", () => {
    render(<NotesCard active={d1} />);
    const ta = screen.getByPlaceholderText(/Notes about this dataset/i);
    fireEvent.change(ta, { target: { value: "field-cooled, 5 K" } });
    expect(useApp.getState().datasets[0].notes).toBeUndefined(); // not yet
    fireEvent.blur(ta);
    expect(useApp.getState().datasets[0].notes).toBe("field-cooled, 5 K");
  });

  it("shows the existing notes for the active dataset", () => {
    const noted = { ...d1, notes: "second cooldown" };
    useApp.setState({ datasets: [noted], activeId: "d1" });
    render(<NotesCard active={noted} />);
    expect(screen.getByDisplayValue("second cooldown")).toBeInTheDocument();
  });

  // R9 (POST_SPRINT_INDEPENDENT_REVIEW): the draft-resync effect is keyed on
  // `active?.id`, not `active?.notes` — deliberately, per the effect's own
  // comment. These two tests pin that choice down as behavior so a future
  // "fix" of the exhaustive-deps warning (e.g. adding `active?.notes` to the
  // dep array) fails loudly instead of silently reintroducing a clobbered
  // in-progress edit.
  it("does not clobber an in-progress, uncommitted edit when the same dataset's notes change elsewhere", () => {
    const { rerender } = render(<NotesCard active={d1} />);
    const ta = screen.getByPlaceholderText(/Notes about this dataset/i);
    fireEvent.change(ta, { target: { value: "mid-edit, not yet blurred" } });
    // Simulate an external update to this SAME dataset's notes (e.g. an
    // import, undo, or another panel writing notes) landing while the user
    // is still typing — same id, new `active` object, different `.notes`.
    const externallyUpdated = { ...d1, notes: "written by something else" };
    rerender(<NotesCard active={externallyUpdated} />);
    expect(ta).toHaveValue("mid-edit, not yet blurred");
  });

  it("resyncs the draft from the new dataset's notes when the active id changes", () => {
    const notedD2 = { ...d2, notes: "second dataset's notes" };
    const { rerender } = render(<NotesCard active={d1} />);
    const ta = screen.getByPlaceholderText(/Notes about this dataset/i);
    fireEvent.change(ta, { target: { value: "unsaved edit on d1" } });
    rerender(<NotesCard active={notedD2} />);
    expect(ta).toHaveValue("second dataset's notes");
  });
});
