// u9: a Curve Fit opened from the palette starts a fresh selection, which used to lose a worksheet's
// "Use as row range" without a word. The range is now OFFERED on the input line ("Use it"), never applied silently.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { seedAnalysisSelection, useAnalysisSelection } from "../../../store/analysisSelection";
import { shiftRowRangesForDelete, shiftRowRangesForInsert } from "../../../store/rowRangeShift";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import { useApp } from "../../../store/useApp";
import AnalysisInputReview from "./AnalysisInputReview";

const dataset: Dataset = {
  id: "d1",
  name: "experiment.csv",
  data: {
    time: Array.from({ length: 48 }, (_v, i) => i),
    values: Array.from({ length: 48 }, (_v, i) => [i * 10]),
    labels: ["Signal"], units: ["V"], metadata: {},
  },
};

const itemRange = () => useAnalysisSelection.getState().selection!.items[0].rowRange;

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
  useApp.setState({ datasets: [dataset], activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0] });
  // The worksheet gesture: rows 21-44 selected, "Use as row range" (the Analysis Center owns the selection).
  openWorksheetRowRange("d1", Array.from({ length: 24 }, (_v, i) => 20 + i));
  expect(itemRange()).toEqual({ from: 20, to: 43 });
  // Then Curve Fit opens from the palette: its own fresh selection, no range.
  seedAnalysisSelection("curvefit", "tool-default");
});

describe("a row range the palette-opened fit is not using", () => {
  it("is offered on the input line, and not applied until the button is pressed", () => {
    expect(itemRange()).toBeUndefined();
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    expect(screen.getByRole("status")).toHaveTextContent("Row range rows 21-44 is set: Use it");
    expect(screen.getByText(/48 of 48 rows|Input: experiment\.csv.*48/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    expect(itemRange()).toEqual({ from: 20, to: 43 });
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
    expect(screen.getByText(/rows 21-44 · 24 of 24 rows/)).toBeInTheDocument();
  });

  it("is not re-offered after the user clears it", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    fireEvent.change(screen.getByLabelText("Rows from"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("to"), { target: { value: "" } });
    expect(itemRange()).toBeNull();
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
  });

  it("is not offered to a tool that ignores a range, nor once the worksheet is shorter than the range", () => {
    const { unmount } = render(<AnalysisInputReview toolId="curvefit" singleY policy={{ exclusions: "drop", selectedRows: "ignore", range: "ignore", rowRange: "ignore" }} />);
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
    unmount();
    useApp.setState({ datasets: [{ ...dataset, data: { ...dataset.data, time: dataset.data.time.slice(0, 30), values: dataset.data.values.slice(0, 30) } }] });
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
  });

  it("follows a row insert above it, and stops being offered once its rows are deleted", () => {
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    act(() => shiftRowRangesForInsert("d1", 0, 2));
    expect(screen.getByRole("status")).toHaveTextContent("Row range rows 23-46 is set");
    act(() => shiftRowRangesForDelete("d1", new Set(Array.from({ length: 24 }, (_v, i) => 22 + i))));
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
  });

  it("a fit that already carries the range (the Analysis Center path) has nothing to offer", () => {
    openWorksheetRowRange("d1", Array.from({ length: 24 }, (_v, i) => 20 + i));
    // Same tool id seeded from the worksheet selection: carried, as before.
    useAnalysisSelection.setState({ toolId: "curvefit" });
    render(<AnalysisInputReview toolId="curvefit" singleY />);
    expect(screen.queryByRole("button", { name: "Use it" })).toBeNull();
  });
});
