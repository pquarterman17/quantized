// Residual R9 (P3.3): while a workspace's chunk is still in flight, App.tsx
// renders its Suspense placeholder, and that placeholder registered no Escape
// surface — so for the first few hundred ms Escape did nothing at all. Both
// chunks are mocked to NEVER arrive, so these cases see only the placeholder.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryWorkspace, QuickFigureBuilderWorkspace } from "./workspaceSeams";
import { useApp } from "../../store/useApp";

vi.mock("../Library/LibraryWorkspace", () => new Promise(() => {}));
vi.mock("../workshops/quickfigurebuilder/QuickFigureBuilderWorkspace", () => new Promise(() => {}));

beforeEach(() => {
  useApp.setState({ quickFigureBuilderDatasetId: null });
});

describe("a workspace still loading its chunk already owns Escape (R9)", () => {
  it("Escape closes the Library workspace placeholder", async () => {
    function Harness() {
      const [tiles, setTiles] = useState(true);
      return tiles ? <LibraryWorkspace onClose={() => setTiles(false)} /> : <p>stage</p>;
    }
    render(<Harness />);
    expect(screen.getByLabelText("Library workspace")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });

    await waitFor(() => expect(screen.getByText("stage")).toBeInTheDocument());
    expect(screen.queryByLabelText("Library workspace")).not.toBeInTheDocument();
  });

  it("Escape closes the Quick Figure Builder placeholder", async () => {
    useApp.setState({ quickFigureBuilderDatasetId: "d1" });
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.getByLabelText("Quick Figure Builder")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });

    await waitFor(() => expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull());
  });
});
