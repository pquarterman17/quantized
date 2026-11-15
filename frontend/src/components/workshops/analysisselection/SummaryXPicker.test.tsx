import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INDEX_X, xChoiceFromParams, type SummaryXChoice } from "../../../lib/batchSummaryX";
import SummaryXPicker from "./SummaryXPicker";

describe("SummaryXPicker", () => {
  it("typed mode (inputs not loaded yet): names a metadata field or parameter by hand", () => {
    const seen: SummaryXChoice[] = [];
    const onChange = vi.fn((c: SummaryXChoice) => seen.push(c));
    const { rerender } = render(<SummaryXPicker typed choice={INDEX_X} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("summary X from"), { target: { value: "meta:" } });
    expect(seen.at(-1)).toEqual({ source: { kind: "meta", path: [] }, sort: false });
    rerender(<SummaryXPicker typed choice={seen.at(-1)!} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("summary X name"), { target: { value: "Magnetic Field › Value" } });
    expect(seen.at(-1)).toEqual({ source: { kind: "meta", path: ["Magnetic Field", "Value"] }, sort: false });
    rerender(<SummaryXPicker typed choice={{ source: { kind: "param", name: "" }, sort: false }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("summary X name"), { target: { value: "T" } });
    expect(seen.at(-1)).toEqual({ source: { kind: "param", name: "T" }, sort: false });
  });

  it("picked mode offers the metadata fields and parameter rows it is given", () => {
    render(<SummaryXPicker choice={INDEX_X} onChange={() => undefined}
      metaFields={[{ path: ["Temperature"], label: "Temperature" }]} params={["Field"]} />);
    const options = Array.from(screen.getByLabelText("summary X from").querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Input order (1, 2, …)", "Number in the name", "Metadata: Temperature", "Parameter: Field"]);
  });

  it("the folder-run dialog answers map to the same choice", () => {
    expect(xChoiceFromParams({ xFrom: "Metadata field", xName: "Temperature", xSort: true }))
      .toEqual({ source: { kind: "meta", path: ["Temperature"] }, sort: true });
    expect(xChoiceFromParams({ xFrom: "Input order", xName: "", xSort: false })).toEqual(INDEX_X);
    expect(xChoiceFromParams({ xFrom: "Number in the name", xName: "", xSort: false }).source).toEqual({ kind: "name" });
  });
});
