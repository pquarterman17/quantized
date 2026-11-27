import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { figureRevision } from "./figureRevision";
import { defaultPlotView } from "./plotview";

const doc = (title: string, id = "f1", name = "Fig") =>
  createFigureDocument({ id, name, datasetId: "d1", view: { ...defaultPlotView(), plotTitle: title } });

describe("figureRevision", () => {
  it("is the same for the same content, whatever its id or name", () => {
    expect(figureRevision(doc("A"))).toBe(figureRevision(doc("A", "other-id", "Other name")));
    expect(figureRevision(doc("A"))).toMatch(/^[0-9a-f]{8}$/);
  });
  it("changes with any figure edit or output choice", () => {
    expect(figureRevision(doc("A"))).not.toBe(figureRevision(doc("B")));
    const a = doc("A");
    expect(figureRevision({ ...a, output: { ...a.output, dpi: a.output.dpi + 100 } })).not.toBe(figureRevision(a));
  });
});
