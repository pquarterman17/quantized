// Unit coverage for the wrapper itself (plans/BUNDLE_HEADROOM.md slice 6):
// given rows, it must render real DatasetRow content. See
// libraryFlatRowsSeam.test.tsx for the chunk-deferral half (whether Library.tsx
// fetches this module at the right time) — that file deliberately never
// imports this module directly, so this one carries the render-output check.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LibraryFlatRows from "./LibraryFlatRows";
import type { Dataset } from "../../lib/types";

const ds = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
});

describe("LibraryFlatRows", () => {
  it("renders a DatasetRow per shown dataset", () => {
    const shown = [ds("a"), ds("b")];
    render(
      <LibraryFlatRows
        shown={shown}
        datasets={shown}
        activeId="a"
        selectedIds={[]}
        canReorder={false}
        sheetOf={new Map()}
        onFilterTag={vi.fn()}
      />,
    );
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("renders nothing for an empty list (the invariant that makes the gate free)", () => {
    const { container } = render(
      <LibraryFlatRows
        shown={[]}
        datasets={[]}
        activeId={null}
        selectedIds={[]}
        canReorder={false}
        sheetOf={new Map()}
        onFilterTag={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
