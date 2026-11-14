// Typing and pasting past the end of a worksheet (worksheet audit #4/#14):
// the sheet used to CLIP — a value typed below the last row had nowhere to go
// and a pasted block was cut at the bottom — so a new workbook could not be
// filled in. Now it grows, and the whole gesture is ONE undo step.

import { beforeEach, describe, expect, it } from "vitest";

import { blankWorksheetData, newWorkbook, nextBookName } from "./newWorkbook";
import { useApp } from "./useApp";
import { growAndSetCell, pasteGrowing } from "./worksheetGrow";

const st = () => useApp.getState();
const ds = (id = "w") => st().datasets.find((d) => d.id === id)!;

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "w", name: "Book1", data: blankWorksheetData(2) }],
    activeId: "w",
    history: [],
    future: [],
    status: "",
  });
});

describe("growAndSetCell", () => {
  it("a value typed into the entry row appends the row and writes it — one undo step", () => {
    growAndSetCell("w", 2, 0, 5);
    expect(ds().data.time).toHaveLength(3);
    expect(ds().data.values[2]).toEqual([5]);
    expect(st().history.map((h) => h.label)).toEqual(["cell edit"]);
    st().undo();
    expect(ds().data.time).toHaveLength(2);
  });

  it("grows from the end of a text-only tail, never into it (the text stays on its rows)", () => {
    useApp.setState({
      datasets: [{ id: "t", name: "T", data: { time: [1], values: [[1]], labels: ["A"], units: [""], metadata: { text_columns: { S: ["a", "b"] } } } }],
    });
    growAndSetCell("t", 2, 0, 5);
    const d = ds("t");
    expect(d.data.values[2]).toEqual([5]);
    expect((d.data.metadata.text_columns as Record<string, string[]>).S).toEqual(["a", "b"]);
  });

  it("a blank typed into the entry row adds nothing", () => {
    growAndSetCell("w", 2, 0, Number.NaN);
    expect(ds().data.time).toHaveLength(2);
    expect(st().history).toEqual([]);
  });
});

describe("pasteGrowing", () => {
  it("a block running off the bottom and the right grows the sheet first, then pastes; one undo", () => {
    const status = pasteGrowing("w", "1\t10\t100\n2\t20\t200\n3\t30\t300\n", 1, -1, [0, 1], true);
    expect(ds().data.time).toEqual([NaN, 1, 2, 3]);
    expect(ds().data.labels).toEqual(["A", "B"]);
    expect(ds().data.values.slice(1)).toEqual([[10, 100], [20, 200], [30, 300]]);
    expect(status).toBe("pasted 9 cells (added 2 rows and 1 column)");
    expect(st().history.map((h) => h.label)).toEqual(["paste cells"]);
    st().undo();
    expect(ds().data.time).toHaveLength(2);
    expect(ds().data.labels).toEqual(["A"]);
  });

  it("without growth (a filtered/sorted view) the overflow is clipped and reported", () => {
    const status = pasteGrowing("w", "1\n2\n3\n", 1, -1, [0, 1], false);
    expect(ds().data.time).toEqual([NaN, 1]);
    expect(status).toMatch(/dropped 2 outside the sheet/);
  });

  it("text in a numeric column is skipped, not written as a blank", () => {
    const status = pasteGrowing("w", "1\tabc\n", 0, -1, [0, 1], true);
    expect(ds().data.values[0]).toEqual([NaN]);
    expect(ds().data.time[0]).toBe(1);
    expect(status).toMatch(/skipped 1 non-numeric/);
  });
});

describe("File › New workbook", () => {
  it("adds a blank Book with an X column and one value column, opens its worksheet", () => {
    useApp.setState({ datasets: [], activeId: null, stageTab: "plot" });
    newWorkbook();
    newWorkbook();
    expect(st().datasets.map((d) => d.name)).toEqual(["Book1", "Book2"]);
    const d = st().datasets[1];
    expect(d.data.time).toHaveLength(32);
    expect(d.data.labels).toEqual(["A"]);
    expect(d.data.metadata.x_column_name).toBe("X");
    expect(st().stageTab).toBe("worksheet");
    expect(st().worksheetId).toBe(d.id);
    expect(nextBookName(["Book1", "Book3"])).toBe("Book2");
  });
});
