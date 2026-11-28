// Acceptance pass 15 U4: "Pareto chart..." used to open on a continuous column and fail at once with "72 categories
// exceed the Pareto limit of 30". The default Category is now a text/categorical column, else a column with at most
// 30 distinct values, else nothing chosen with a hint (no request sent).

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postBlob } from "../../../lib/api/http";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import Plots2Stage from "./Plots2Stage";

vi.mock("../../../lib/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/http")>()),
  postBlob: vi.fn(),
  postDownload: vi.fn(),
}));

const N = 72;
const GRP = Array.from({ length: N }, (_, i) => ["ctl", "low", "high"][i % 3]);
// `id` is a running number, `val` continuous: both have 72 distinct values; `grp` has 3 levels.
const sheet = (withText: boolean): Dataset => ({
  id: "sv", name: "sv.csv",
  data: {
    time: Array.from({ length: N }, (_, i) => i + 1),
    values: Array.from({ length: N }, (_, i) => [i + 1, 3 + i * 0.37]),
    labels: ["id", "val"], units: ["", ""],
    metadata: withText ? { text_columns: { grp: GRP } } : {},
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postBlob).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  useApp.setState(useApp.getInitialState(), true);
});

const category = () => screen.getByRole("combobox", { name: "Category column" }) as HTMLSelectElement;
const shown = () => category().selectedOptions[0]?.textContent;

describe("Pareto default Category", () => {
  it("opens on the text column, not on a continuous channel, and sends a valid request", async () => {
    useApp.setState({ datasets: [sheet(true)], activeId: "sv" });
    render(<Plots2Stage kind="pareto" />);
    expect(shown()).toBe("grp");
    await waitFor(() => expect(vi.mocked(postBlob).mock.calls.length).toBeGreaterThan(0));
    expect(screen.queryByText(/exceed the Pareto limit/)).toBeNull();
  });

  it("with no column of at most 30 levels, opens with no category and a hint, sending nothing", async () => {
    useApp.setState({ datasets: [sheet(false)], activeId: "sv" });
    render(<Plots2Stage kind="pareto" />);
    expect(shown()).toBe("(choose a column)");
    expect(await screen.findByText(/Pick a Category column: no column has 30 or fewer distinct values/)).toBeTruthy();
    expect(vi.mocked(postBlob)).not.toHaveBeenCalled();
  });
});
