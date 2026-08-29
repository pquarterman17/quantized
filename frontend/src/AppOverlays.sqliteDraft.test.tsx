// Regression for the draft-retention half of the post-#263 review round.
//
// Before #261 `SqliteQueryDialog` was eagerly mounted and self-hid with
// `if (!open) return null`, so a half-typed query survived closing and
// reopening the dialog. #261 made it a `lazyPanel()` gated directly on the
// store flag -- correct for startup cost, but it UNMOUNTS on close and throws
// the draft away. AppOverlays already had `useKeepMountedAfterOpen` for
// exactly this (six other dialogs use it); this pins the behaviour so the
// lazy boundary cannot silently cost the draft again.

import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppOverlays from "./AppOverlays";
import { useSqliteQueryDialog } from "./store/sqliteQueryDialog";
import { useApp } from "./store/useApp";

vi.mock("./lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  querySqlite: vi.fn(),
}));

beforeEach(() => {
  useSqliteQueryDialog.setState({ open: false });
  useApp.setState({ datasets: [], activeId: null, toolWindowLayout: {} });
});

describe("SQLite dialog draft retention across close/reopen", () => {
  it("keeps a half-typed query when the dialog is closed and reopened", async () => {
    render(<AppOverlays />);

    useSqliteQueryDialog.getState().show();
    const path = await screen.findByLabelText("Database file path");
    fireEvent.change(path, { target: { value: "C:\\data\\half-typed.sqlite" } });

    // Close, then reopen -- the draft must still be there.
    useSqliteQueryDialog.getState().close();
    await waitFor(() =>
      expect(screen.queryByLabelText("Database file path")).not.toBeInTheDocument(),
    );

    useSqliteQueryDialog.getState().show();
    const reopened = await screen.findByLabelText("Database file path");
    expect(reopened).toHaveValue("C:\\data\\half-typed.sqlite");
  });
});
