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
});
