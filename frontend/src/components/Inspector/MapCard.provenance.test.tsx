// A dataset that Map gridding made says how, and the card's display settings are
// labelled as display-only; any other map shows no note.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import MapCard from "./MapCard";

const mk = (id: string, metadata: Record<string, unknown>) => ({
  id, name: id, data: { time: [0, 1], values: [[0], [1]], labels: ["Z"], units: [""], metadata },
}) as never;

beforeEach(() => useApp.setState({ mapMethod: "linear", mapRes: 200 }));

describe("MapCard provenance", () => {
  it("names the gridding of a Map-gridding result", async () => {
    useApp.setState({
      datasets: [mk("g", { map_op: { op: "grid_xyz", method: "natural", nx: 60, ny: 40 } })],
      activeId: "g",
    });
    render(<MapCard />);
    const note = await screen.findByRole("note", { name: "Map provenance" });
    expect(note).toHaveTextContent("Natural neighbour (Sibson), 60 × 40 cells");
    expect(note).toHaveTextContent(/only change how the map is drawn/);
  });

  it("shows nothing for an ordinary map", async () => {
    useApp.setState({ datasets: [mk("p", {})], activeId: "p" });
    render(<MapCard />);
    await screen.findByLabelText("Grid method");
    expect(screen.queryByRole("note", { name: "Map provenance" })).toBeNull();
  });
});
