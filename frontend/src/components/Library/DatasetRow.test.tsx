import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { folderDatasets } from "../../lib/foldertree";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import DatasetRow from "./DatasetRow";
import { DATASET_DND } from "./useLibraryTree";

const plain: Dataset = {
  id: "plain",
  name: "sample.dat",
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
};

const sheet1: Dataset = {
  id: "sheet1",
  name: "XRD:Book4",
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: { origin_book: "Book4" } },
};

const baseProps = {
  active: false,
  selected: false,
  showReorder: false,
  canMoveUp: false,
  canMoveDown: false,
  onFilterTag: () => {},
};

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
});

describe("DatasetRow sheet affordance", () => {
  it("renders no sheet chip or indent for an ordinary dataset", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    expect(screen.queryByText(/sheet \d/)).not.toBeInTheDocument();
    expect(container.querySelector(".qzk-ds")).not.toHaveClass("qzk-ds-sheet");
  });

  it("renders no sheet chip for a group's parent (sheet 1, sheetNumber undefined)", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} />);
    expect(screen.queryByText(/sheet \d/)).not.toBeInTheDocument();
    expect(container.querySelector(".qzk-ds")).not.toHaveClass("qzk-ds-sheet");
  });

  it("renders the indent class + 'sheet N' chip for a non-first sheet", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} sheetNumber={2} />);
    expect(screen.getByText(/sheet 2/)).toBeInTheDocument();
    expect(container.querySelector(".qzk-ds")).toHaveClass("qzk-ds-sheet");
  });
});

describe("DatasetRow pending lazy book (ORIGIN_FILE_DECODE_PLAN #38)", () => {
  it("shows the TRUE row/channel counts from `pending`, not the small preview's", () => {
    const lazy: Dataset = {
      id: "lazy1",
      name: "PNR:Book2",
      data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: ["Oe"], metadata: {} },
      pending: { kind: "path", path: "/PNR.opj", bookId: "Book2", rows: 42180, cols: 4 },
    };
    render(<DatasetRow dataset={lazy} {...baseProps} />);
    expect(screen.getByText(/42180 pts/)).toBeInTheDocument();
    expect(screen.getByText("4ch")).toBeInTheDocument();
  });

  it("shows the real (preview) counts for a fully-loaded dataset", () => {
    render(<DatasetRow dataset={plain} {...baseProps} />);
    expect(screen.getByText(/1 pts/)).toBeInTheDocument();
    expect(screen.getByText("1ch")).toBeInTheDocument();
  });
});

describe("DatasetRow activation routing (WORKSHEET_PLAN item 15 — origin book click opens…)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [plain, sheet1],
      activeId: null,
      worksheetId: null,
      selectedIds: [],
      stageTab: "plot",
      originBookClickOpens: "worksheet",
    });
  });

  it("a plain click on a non-Origin row activates it exactly as before (plot-intent)", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    const s = useApp.getState();
    expect(s.activeId).toBe("plain");
    expect(s.worksheetId).toBeNull();
  });

  it("a plain click on an Origin book row opens the Worksheet instead of plotting it (default pref)", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    const s = useApp.getState();
    expect(s.worksheetId).toBe("sheet1");
    expect(s.stageTab).toBe("worksheet");
    expect(s.activeId).toBeNull(); // the plot (nothing, here) is untouched
  });

  it("right-clicking an unselected Origin book row also routes through the worksheet-intent path", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} selected={false} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(useApp.getState().worksheetId).toBe("sheet1");
    expect(useApp.getState().activeId).toBeNull();
  });

  it("'Plot (make active)' in the context menu ALWAYS forces the plot, even for an Origin book", () => {
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Plot (make active)"));
    const s = useApp.getState();
    expect(s.activeId).toBe("sheet1");
    expect(s.worksheetId).toBeNull();
  });

  it("the 'plot' preference restores click-to-plot for an Origin book too", () => {
    useApp.setState({ originBookClickOpens: "plot" });
    const { container } = render(<DatasetRow dataset={sheet1} {...baseProps} />);
    fireEvent.click(container.querySelector(".qzk-ds")!);
    expect(useApp.getState().activeId).toBe("sheet1");
    expect(useApp.getState().worksheetId).toBeNull();
  });
});

describe("DatasetRow re-import menu entry (MAIN_PLAN #10)", () => {
  it("labels it 'Re-import from source' and calls reimportDataset for a sourced dataset", () => {
    const withSource: Dataset = { ...plain, id: "src1", source: { kind: "path", path: "/data/x.dat" } };
    useApp.setState({ datasets: [withSource], activeId: null, selectedIds: [] });
    const spy = vi.spyOn(useApp.getState(), "reimportDataset").mockResolvedValue(undefined);
    const { container } = render(<DatasetRow dataset={withSource} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.getByText("Re-import from source")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Re-import from source"));
    expect(spy).toHaveBeenCalledWith("src1");
  });

  it("labels it 'Re-import from file…' for a source-less dataset", () => {
    const { container } = render(<DatasetRow dataset={plain} {...baseProps} />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    expect(screen.getByText("Re-import from file…")).toBeInTheDocument();
  });
});

// project-organization plan item 3b: drop-between reorder. jsdom has no real
// DnD or layout (see AxisDropZones.test.tsx's header note for the same
// workaround this borrows: a hand-built DragEvent with clientX/clientY +
// dataTransfer, dispatched via RTL's low-level fireEvent, plus a mocked
// getBoundingClientRect).
function datasetTransfer(id: string) {
  return {
    types: [DATASET_DND],
    getData: (t: string) => (t === DATASET_DND ? id : ""),
    setData: () => {},
  };
}
const foreignTransfer = { types: ["Files"], getData: () => "", setData: () => {} };

function fireDrag(el: Element, type: "dragover" | "drop", clientY: number, dataTransfer: unknown) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clientX", { value: 10, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  fireEvent(el, evt);
}

function setRowRect(el: Element) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: 100,
    height: 40,
    bottom: 140,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: 100,
    toJSON: () => "",
  } as DOMRect);
}

describe("DatasetRow drop-between reorder", () => {
  const dsA: Dataset = { id: "a", name: "a", data: plain.data, folderId: "f1", order: 0 };
  const dsB: Dataset = { id: "b", name: "b", data: plain.data, folderId: "f1", order: 1 };
  const dsC: Dataset = { id: "c", name: "c", data: plain.data, folderId: "f1", order: 2 };

  beforeEach(() => {
    useApp.setState({
      datasets: [dsA, dsB, dsC],
      folders: [{ id: "f1", name: "F", parentId: null, order: 0 }],
      activeId: null,
      selectedIds: [],
    });
  });

  it("shows the above/below indicator class per the half the pointer is over", () => {
    const { container } = render(<DatasetRow dataset={dsA} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    setRowRect(row);
    fireDrag(row, "dragover", 110, datasetTransfer("c")); // top half (100-120)
    expect(row).toHaveClass("drop-above");
    fireDrag(row, "dragover", 135, datasetTransfer("c")); // bottom half (120-140)
    expect(row).toHaveClass("drop-below");
    expect(row).not.toHaveClass("drop-above");
  });

  it("dropping on the top half inserts the dragged dataset before this row", () => {
    const { container } = render(<DatasetRow dataset={dsA} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    setRowRect(row);
    fireDrag(row, "dragover", 110, datasetTransfer("c")); // top half
    fireDrag(row, "drop", 110, datasetTransfer("c"));
    // Order lives in the `.order` field (sort key), not the flat array's
    // element position — read it back through the same folderDatasets view
    // the tree renders through (mirrors lib/foldertree.test.ts's convention).
    expect(folderDatasets(useApp.getState().datasets, "f1").map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("dropping on the bottom half inserts the dragged dataset after this row", () => {
    const { container } = render(<DatasetRow dataset={dsA} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    setRowRect(row);
    fireDrag(row, "dragover", 135, datasetTransfer("c")); // bottom half
    fireDrag(row, "drop", 135, datasetTransfer("c"));
    expect(folderDatasets(useApp.getState().datasets, "f1").map((d) => d.id)).toEqual(["a", "c", "b"]);
  });

  it("dropping onto itself is a no-op", () => {
    const { container } = render(<DatasetRow dataset={dsA} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    setRowRect(row);
    fireDrag(row, "drop", 110, datasetTransfer("a"));
    expect(folderDatasets(useApp.getState().datasets, "f1").map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("moves a dataset from a different folder into this row's folder", () => {
    useApp.setState({
      datasets: [dsA, dsB, { ...dsC, folderId: "f2" }],
      folders: [
        { id: "f1", name: "F1", parentId: null, order: 0 },
        { id: "f2", name: "F2", parentId: null, order: 1 },
      ],
    });
    const { container } = render(<DatasetRow dataset={dsA} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    setRowRect(row);
    fireDrag(row, "drop", 110, datasetTransfer("c")); // top half of a (folder f1)
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "c")!.folderId).toBe("f1");
    expect(folderDatasets(s.datasets, "f1").map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores a non-dataset drag (e.g. an OS file drop)", () => {
    const { container } = render(<DatasetRow dataset={dsA} {...baseProps} />);
    const row = container.querySelector(".qzk-ds")!;
    setRowRect(row);
    fireDrag(row, "dragover", 110, foreignTransfer);
    expect(row).not.toHaveClass("drop-above");
    expect(row).not.toHaveClass("drop-below");
  });
});

describe("DatasetRow bulk move (project-organization plan item 8)", () => {
  const a: Dataset = { id: "a", name: "a", data: plain.data };
  const b: Dataset = { id: "b", name: "b", data: plain.data };
  const c: Dataset = { id: "c", name: "c", data: plain.data };
  const grp = { id: "grp", name: "Grp", parentId: null, order: 0 };

  it("moves the whole multi-selection into the picked folder", () => {
    useApp.setState({
      datasets: [a, b, c],
      folders: [grp],
      activeId: "a",
      selectedIds: ["a", "b"],
    });
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText('Move 2 selected to "Grp"'));
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "a")!.folderId).toBe("grp");
    expect(s.datasets.find((d) => d.id === "b")!.folderId).toBe("grp");
    expect(s.datasets.find((d) => d.id === "c")!.folderId).toBeUndefined();
  });

  it("a lone row keeps the single-dataset move label and behavior", () => {
    useApp.setState({ datasets: [a, b], folders: [grp], activeId: "a", selectedIds: ["a"] });
    const { container } = render(<DatasetRow dataset={a} {...baseProps} selected />);
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText('Move to "Grp"'));
    const s = useApp.getState();
    expect(s.datasets.find((d) => d.id === "a")!.folderId).toBe("grp");
    expect(s.datasets.find((d) => d.id === "b")!.folderId).toBeUndefined();
  });

  it("offers 'Move N selected to top level' for a multi-selection of foldered rows", () => {
    useApp.setState({
      datasets: [
        { ...a, folderId: "grp" },
        { ...b, folderId: "grp" },
      ],
      folders: [grp],
      activeId: "a",
      selectedIds: ["a", "b"],
    });
    const { container } = render(
      <DatasetRow dataset={{ ...a, folderId: "grp" }} {...baseProps} selected />,
    );
    fireEvent.contextMenu(container.querySelector(".qzk-ds")!);
    fireEvent.click(screen.getByText("Move 2 selected to top level"));
    const s = useApp.getState();
    expect(s.datasets.every((d) => d.folderId === undefined)).toBe(true);
  });
});
