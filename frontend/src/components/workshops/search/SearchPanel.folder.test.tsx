// "In folder…" scope of Find in project (G23): results grouped by file, the
// skipped list, truncation notice, and Open through the Recent Projects reopen.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SearchPanel from "./SearchPanel";
import { useApp } from "../../../store/useApp";

const search = vi.hoisted(() => vi.fn());
const reopen = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/projectSearch", () => ({ searchProjectFolder: search }));
vi.mock("../../../commands/recentProjectReopen", () => ({ openRecentProject: reopen }));

const RESPONSE = {
  folder: "/data/proj",
  scanned: 3,
  truncated: "max_files",
  elapsed_s: 0.1,
  matches: [
    {
      path: "/data/proj/a/one.dwk",
      relpath: "a/one.dwk",
      size: 10,
      hit_count: 2,
      hits: [
        { kind: "dataset", location: 'dataset "2311-B fit.csv"', snippet: "2311-B fit.csv" },
        { kind: "column", location: 'dataset "2311-B fit.csv", column "Rxy"', snippet: "Rxy" },
      ],
    },
  ],
  skipped: [{ path: "/data/proj/bad.dwk", reason: "not a valid workspace file (bad JSON)" }],
};

beforeEach(() => {
  search.mockReset().mockResolvedValue(RESPONSE);
  reopen.mockReset().mockResolvedValue("applied");
  useApp.setState({
    datasets: [], folders: [], reports: [], analysisResults: [], originFigures: [], searchOpen: true,
  });
});

const openFolderScope = async () => {
  render(<SearchPanel />);
  fireEvent.change(screen.getByPlaceholderText(/dataset, column/), { target: { value: "2311-B" } });
  fireEvent.click(screen.getByRole("button", { name: "In folder" }));
  fireEvent.change(await screen.findByPlaceholderText(/folder of saved projects/), { target: { value: "/data/proj" } });
};

describe("SearchPanel folder scope", () => {
  it("is not searched until Search is pressed, then groups hits by file", async () => {
    await openFolderScope();
    const go = await screen.findByRole("button", { name: "Search" });
    expect(search).not.toHaveBeenCalled();
    fireEvent.click(go);
    expect(await screen.findByText("a/one.dwk")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("/data/proj", "2311-B");
    expect(screen.getAllByTestId("folder-match")).toHaveLength(1);
    expect(screen.getByText(/2 hits/)).toBeInTheDocument();
    expect(screen.getByText(/Stopped at the file limit/)).toBeInTheDocument();
    expect(screen.getByText(/1 file skipped/)).toBeInTheDocument();
    expect(screen.getByText(/bad\.dwk: not a valid workspace file/)).toBeInTheDocument();
  });

  it("Open reopens the file through the existing project-open path", async () => {
    let opened: string[] | null = null;
    reopen.mockImplementation(async (name: string, path: string) => {
      opened = [name, path];
      return "applied";
    });
    await openFolderScope();
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await waitFor(() => expect(opened).toEqual(["one.dwk", "/data/proj/a/one.dwk"]));
  });

  it("shows a refusal instead of results", async () => {
    search.mockRejectedValue(new Error("folder is outside the allowed folders"));
    await openFolderScope();
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/outside the allowed folders/);
  });
});
