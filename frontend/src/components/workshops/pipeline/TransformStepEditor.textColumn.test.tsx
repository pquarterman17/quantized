// An unstack step recorded with a TEXT category (by name, as a join key is)
// must stay that column in the step editor: the column picker showed only
// channels, so the name had no option and re-picking turned it into a number.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep } from "../../../lib/pipelineStep";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import TransformStepEditor from "./TransformStepEditor";

const ds: Dataset = {
  id: "d",
  name: "long.csv",
  data: { time: [1, 2], values: [[1], [2]], labels: ["Signal"], units: [""], metadata: { text_columns: { Sample: ["a", "b"] } } },
};

beforeEach(() => useApp.setState({ datasets: [ds], activeId: "d" }));

describe("TransformStepEditor — a text category", () => {
  it("shows the recorded text column, and applies it back as a name", () => {
    const step = makeStep("transform", "Unstack", "", { op: "unstack", key: -1, category: "Sample", value: 0, aggregate: "mean" });
    const onApply = vi.fn();
    render(<TransformStepEditor step={step} onApply={onApply} />);
    const picker = screen.getByRole("combobox", { name: "category column" });
    expect(picker).toHaveValue("t:Sample");
    fireEvent.change(picker, { target: { value: "0" } });
    expect(picker).toHaveValue("0");
    fireEvent.change(picker, { target: { value: "t:Sample" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply.mock.calls[0][0]).toMatchObject({ category: "Sample" });
  });
});
