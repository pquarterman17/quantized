// UX8-I: an untagged Tree row spends no line on the add-tag "+" -- it is an
// overlay that paints on hover/focus only -- so a dataset costs one row.

import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import DatasetRow from "./DatasetRow";

const ds: Dataset = {
  id: "d1",
  name: "sample.dat",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: ["Oe"], metadata: {} },
};
const props = { active: false, selected: false, showReorder: false, canMoveUp: false, canMoveDown: false, onFilterTag: () => {} };

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: null, selectedIds: [] });
});

describe("DatasetRow tag row density (UX8-I)", () => {
  it("an untagged compact row's tag container is the resting overlay", () => {
    const { container } = render(<DatasetRow dataset={ds} {...props} treeMode />);
    expect(container.querySelector(".qzk-ds-tags")).toHaveClass("qzk-ds-tags-resting");
  });

  it("a tagged row, and the flat card layout, keep the in-flow tag row", () => {
    const tagged = { ...ds, tags: ["anneal"] };
    expect(render(<DatasetRow dataset={tagged} {...props} treeMode />).container.querySelector(".qzk-ds-tags")).not.toHaveClass("qzk-ds-tags-resting");
    expect(render(<DatasetRow dataset={ds} {...props} />).container.querySelector(".qzk-ds-tags")).not.toHaveClass("qzk-ds-tags-resting");
  });

  it("the resting overlay is out of flow, invisible at rest, and shown on hover/focus", () => {
    const css = readFileSync(join(__dirname, "../../styles/shell.css"), "utf8");
    expect(css).toMatch(/\.qzk-ds-tags-resting \{[^}]*position: absolute[^}]*opacity: 0/);
    expect(css).toMatch(/\.qzk-ds:hover \.qzk-ds-tags-resting[\s\S]*?\.qzk-ds:focus-within \.qzk-ds-tags-resting[^{]*\{ opacity: 1/);
  });
});
