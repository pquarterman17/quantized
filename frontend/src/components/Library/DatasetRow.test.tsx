import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import DatasetRow from "./DatasetRow";

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
