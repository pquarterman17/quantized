// SILENT_STATE_CORRUPTION_PLAN #10, instance half. The Corrections card was
// mounted for ANY active dataset with no `derivedFrom` gate, offering an
// affordance that rebuilt a derived worksheet from its cached copy of the
// source instead of the source's current data. The class fix lives in
// store/corrections.ts (it also covers folderOps/pipeline/baseline); this
// asserts the card is not offered in the first place.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import Inspector from "./Inspector";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["A"],
  units: ["emu"],
  metadata: {},
};

function seed(active: Dataset): void {
  useApp.setState({ datasets: [active], activeId: active.id, folders: [] });
}

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, folders: [] });
});

describe("Inspector corrections affordance", () => {
  it("offers Corrections for an ordinary dataset", () => {
    seed({ id: "d1", name: "sample", data });
    render(<Inspector />);
    expect(screen.getByText(/corrections/i)).toBeInTheDocument();
  });

  it("does not offer Corrections for a derived worksheet", () => {
    seed({ id: "sheet", name: "derived", data, derivedFrom: { datasetId: "src", pipeline: "smooth=3" }, raw: data });
    render(<Inspector />);
    expect(screen.queryByText(/corrections/i)).not.toBeInTheDocument();
  });
});
