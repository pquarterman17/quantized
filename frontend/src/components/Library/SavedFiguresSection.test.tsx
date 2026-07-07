import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import SavedFiguresSection from "./SavedFiguresSection";
import type { FigureDoc } from "../../lib/figuredoc";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const d1: Dataset = {
  id: "d1",
  name: "loop",
  data: { time: [0], values: [[1]], labels: ["M"], units: [""], metadata: {} },
};

const doc = (over: Partial<FigureDoc> = {}): FigureDoc => ({
  id: "figd-1",
  name: "MH loop",
  datasetId: "d1",
  live: true,
  config: {
    xKey: null,
    yKeys: [0],
    xLog: false,
    yLog: false,
    title: "",
    xLabel: "",
    yLabel: "",
    style: "aps",
    fmt: "pdf",
    dpi: 300,
    overrides: null,
    seriesStyles: null,
  },
  ...over,
});

beforeEach(() => {
  useApp.setState({
    datasets: [d1],
    activeId: null,
    figureDocs: [],
    figureDocSeed: null,
    figureBuilderOpen: false,
  });
});

describe("SavedFiguresSection", () => {
  it("renders nothing without saved figures", () => {
    const { container } = render(<SavedFiguresSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opening a live doc activates its dataset and seeds the builder", () => {
    useApp.setState({ figureDocs: [doc()] });
    render(<SavedFiguresSection />);
    fireEvent.click(screen.getByRole("button", { name: /MH loop/ }));
    const s = useApp.getState();
    expect(s.activeId).toBe("d1");
    expect(s.figureBuilderOpen).toBe(true);
    expect(s.figureDocSeed?.id).toBe("figd-1");
  });

  it("disables a live doc whose dataset was removed; frozen still opens", () => {
    useApp.setState({
      figureDocs: [
        doc({ id: "a", name: "dead", datasetId: null }),
        doc({
          id: "b",
          name: "frozen",
          datasetId: null,
          live: false,
          dataSnapshot: d1.data,
        }),
      ],
    });
    render(<SavedFiguresSection />);
    expect(screen.getByRole("button", { name: /dead/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /frozen/ }));
    expect(useApp.getState().figureDocSeed?.id).toBe("b");
  });

  it("duplicate and delete edit the doc list; dataset removal nulls refs", () => {
    useApp.setState({ figureDocs: [doc()] });
    render(<SavedFiguresSection />);
    fireEvent.click(screen.getByTitle("duplicate figure"));
    expect(useApp.getState().figureDocs).toHaveLength(2);
    expect(useApp.getState().figureDocs[1].name).toBe("MH loop copy");
    fireEvent.click(screen.getAllByTitle("delete figure")[1]);
    expect(useApp.getState().figureDocs).toHaveLength(1);

    useApp.getState().removeDataset("d1");
    expect(useApp.getState().figureDocs[0].datasetId).toBeNull();
  });
});
