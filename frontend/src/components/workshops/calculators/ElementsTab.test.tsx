import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getElements } from "../../../lib/api";
import type { ElementInfo } from "../../../lib/types";
import ElementsTab from "./ElementsTab";

vi.mock("../../../lib/api", () => ({ getElements: vi.fn() }));

const ELEMENTS: ElementInfo[] = [
  { Z: 1, symbol: "H", name: "Hydrogen", mass: 1.008, category: "nonmetal" },
  { Z: 8, symbol: "O", name: "Oxygen", mass: 15.999, category: "nonmetal" },
  { Z: 26, symbol: "Fe", name: "Iron", mass: 55.845, category: "transition metal", density: 7.874 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getElements).mockResolvedValue({ elements: ELEMENTS });
});

describe("ElementsTab", () => {
  it("loads the element table on mount", async () => {
    render(<ElementsTab />);
    expect(await screen.findByText(/Hydrogen/)).toBeInTheDocument();
    expect(screen.getByText(/Iron/)).toBeInTheDocument();
  });

  it("filters by symbol/name and shows details on selection", async () => {
    render(<ElementsTab />);
    await screen.findByText(/Hydrogen/);

    fireEvent.change(screen.getByLabelText("element search"), { target: { value: "fe" } });
    expect(screen.getByText(/Iron/)).toBeInTheDocument();
    expect(screen.queryByText(/Hydrogen/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Iron/));
    expect(screen.getByText("Atomic mass")).toBeInTheDocument();
    expect(screen.getByText(/transition metal/)).toBeInTheDocument();
  });

  it("reports no match for an unknown query", async () => {
    render(<ElementsTab />);
    await screen.findByText(/Hydrogen/);
    fireEvent.change(screen.getByLabelText("element search"), { target: { value: "zzz" } });
    expect(screen.getByText("no match")).toBeInTheDocument();
  });

  it("shows an offline notice when the table can't be fetched", async () => {
    vi.mocked(getElements).mockRejectedValue(new Error("offline"));
    render(<ElementsTab />);
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
  });
});
