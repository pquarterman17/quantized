// Smart folders section (project-organization plan item 9): derived-membership
// sections over saved queries — collapsed by default with a live count chip,
// expand to real DatasetRows, edit/create through the shared param dialog
// (mocked here), delete leaves datasets untouched.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SmartFoldersSection from "./SmartFoldersSection";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const ds = (id: string, name: string, tags?: string[]): Dataset => ({
  id,
  name,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(tags ? { tags } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [ds("d1", "loop1.dat", ["MvsH"]), ds("d2", "xrd.raw")],
    smartFolders: [{ id: "s1", name: "Loops", query: "tag:mvsh" }],
    activeId: "d1",
    selectedIds: ["d1"],
  });
});

describe("SmartFoldersSection", () => {
  it("renders nothing when no smart folders exist", () => {
    useApp.setState({ smartFolders: [] });
    const { container } = render(<SmartFoldersSection onFilterTag={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the folder collapsed with a derived member count; expands to rows", () => {
    render(<SmartFoldersSection onFilterTag={() => {}} />);
    expect(screen.getByText("☆ Loops")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // count chip (d1 only)
    expect(screen.queryByText("loop1.dat")).not.toBeInTheDocument(); // collapsed
    fireEvent.click(screen.getByText("☆ Loops"));
    expect(screen.getByText("loop1.dat")).toBeInTheDocument();
    expect(screen.queryByText("xrd.raw")).not.toBeInTheDocument(); // not a member
  });

  it("membership is derived live — tagging a dataset moves it in on the next render", () => {
    render(<SmartFoldersSection onFilterTag={() => {}} />);
    fireEvent.click(screen.getByText("☆ Loops"));
    expect(screen.queryByText("xrd.raw")).not.toBeInTheDocument();
    useApp.getState().addDatasetTag("d2", "MvsH");
    render(<SmartFoldersSection onFilterTag={() => {}} />);
    expect(useApp.getState().smartFolders).toHaveLength(1); // nothing stored changed
    expect(screen.getAllByText("2").length).toBeGreaterThan(0); // count chip updated
  });

  it("delete removes the smart folder but never the datasets", () => {
    render(<SmartFoldersSection onFilterTag={() => {}} />);
    fireEvent.click(screen.getByTitle("Delete smart folder (datasets are untouched)"));
    expect(useApp.getState().smartFolders).toEqual([]);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("edit round-trips through the param dialog", async () => {
    vi.mocked(askParams).mockResolvedValue({ name: "QD loops", query: "format:qd" });
    render(<SmartFoldersSection onFilterTag={() => {}} />);
    fireEvent.click(screen.getByTitle("Edit smart folder…"));
    await vi.waitFor(() =>
      expect(useApp.getState().smartFolders[0]).toMatchObject({
        name: "QD loops",
        query: "format:qd",
      }),
    );
  });

  it("＋ creates a new smart folder via the dialog (cancel = no-op)", async () => {
    vi.mocked(askParams).mockResolvedValueOnce(null); // cancelled
    render(<SmartFoldersSection onFilterTag={() => {}} />);
    fireEvent.click(screen.getByTitle("New smart folder…"));
    await Promise.resolve();
    expect(useApp.getState().smartFolders).toHaveLength(1);

    vi.mocked(askParams).mockResolvedValueOnce({ name: "XRD", query: "format:rigaku" });
    fireEvent.click(screen.getByTitle("New smart folder…"));
    await vi.waitFor(() => expect(useApp.getState().smartFolders).toHaveLength(2));
    expect(useApp.getState().smartFolders[1]).toMatchObject({
      name: "XRD",
      query: "format:rigaku",
    });
  });
});
