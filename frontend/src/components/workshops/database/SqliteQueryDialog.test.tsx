import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { querySqlite } from "../../../lib/api";
import { useApp } from "../../../store/useApp";
import SqliteQueryDialog, { SHOW_SQLITE_QUERY } from "./SqliteQueryDialog";

vi.mock("../../../lib/api", () => ({ querySqlite: vi.fn() }));

beforeEach(() => {
  vi.mocked(querySqlite).mockReset();
  useApp.setState({ datasets: [], activeId: null, history: [], future: [], toolWindowLayout: {} });
});

describe("SqliteQueryDialog", () => {
  it("opens from the Data command event and loads the result as a dataset", async () => {
    vi.mocked(querySqlite).mockResolvedValue({
      time: [1, 2], values: [[3], [4]], labels: ["signal"], units: [""], metadata: {},
    });
    render(<SqliteQueryDialog />);
    window.dispatchEvent(new Event(SHOW_SQLITE_QUERY));
    expect(await screen.findByText("SQLite query")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Database file path"), { target: { value: "C:\\data\\lab.sqlite" } });
    fireEvent.change(screen.getByLabelText("X column"), { target: { value: "time" } });
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    expect(querySqlite).toHaveBeenCalledWith(expect.objectContaining({ path: "C:\\data\\lab.sqlite", x_column: "time" }));
    expect(useApp.getState().datasets[0].name).toBe("lab (query)");
  });

  it("shows backend errors without closing", async () => {
    vi.mocked(querySqlite).mockRejectedValue(new Error("only SELECT is allowed"));
    render(<SqliteQueryDialog />);
    window.dispatchEvent(new Event(SHOW_SQLITE_QUERY));
    fireEvent.change(await screen.findByLabelText("Database file path"), { target: { value: "lab.db" } });
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only SELECT is allowed");
  });
});

