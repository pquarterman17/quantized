// The two promise-dialog seams of bundle diet slice 8 (plans/BUNDLE_HEADROOM.md):
// `ConfirmDialog.tsx` / `ParamDialog.tsx` are now thin EAGER gates that keep
// `askConfirm` / `askParams` and mount the dialog BODY (`ConfirmDialogBody.tsx`
// / `ParamDialogBody.tsx`) as a lazy chunk only while a request is pending.
//
// `src/architecture.test.ts`'s SEAMS list holds the static half (nothing may
// value-import a body; each gate reaches its body through a dynamic import()).
// This file holds the runtime half, and it records IMPORTS rather than only
// DOM: both bodies return null while nothing is pending, so a gate that
// mounted them unconditionally -- handing back the entire eager saving --
// would look identical to the real gate at the DOM layer (the slice-4 lesson).
// The load-failure contract lives in `lazyDialogSeamFailure.test.tsx`, a
// separate file because its module mock makes the chunk unloadable.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import ParamDialog, { askParams } from "./ParamDialog";
import type { ParamValues } from "../../lib/params";
// Warm the bodies' DEPENDENCIES (not the bodies -- that would fire the
// recorder below) so the first ask waits on the body's own small transform,
// not on a cold vite-node transform of its whole subtree (measured ~2 s cold
// in isolation, which is test-environment cost, not app behaviour).
import "../primitives";
import "./ParamFields";
import "./useDialogFocus";
import "../../lib/escapeStack";

const { loaded, track } = vi.hoisted(() => {
  const loaded: string[] = [];
  const track =
    (name: string) =>
    async (importOriginal: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> => {
      loaded.push(name);
      return await importOriginal();
    };
  return { loaded, track };
});
vi.mock("./ConfirmDialogBody", track("ConfirmDialogBody"));
vi.mock("./ParamDialogBody", track("ParamDialogBody"));

// One test on purpose: the recorder is module-scoped and each body is
// imported once per file, so the order of events below IS the claim --
// nothing before the first ask, only the asked-for body after it, and the
// second open of a body mounts without another fetch.
describe("lazy promise dialogs (bundle diet slice 8)", () => {
  it("loads each body only when asked, works after the load, and reopens synchronously", async () => {
    const { container } = render(
      <>
        <ConfirmDialog />
        <ParamDialog />
      </>,
    );
    // Nothing pending: nothing rendered AND nothing fetched.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
    expect(loaded).toEqual([]);

    // First confirm of the "session": the body loads, then behaves as before.
    let confirmed!: Promise<boolean>;
    act(() => {
      confirmed = askConfirm("Remove everything?", "gone forever", "Remove all", true);
    });
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Remove everything?");
    expect(loaded).toEqual(["ConfirmDialogBody"]);
    // Focus moves in the body's effect, which can trail the DOM commit when
    // the load resolves outside act (lost that race once under a loaded
    // full-suite run) -- wait on the focus STATE. (No `import()` of a body
    // path in this file: vitest then loads it early and defeats the recorder.)
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    await expect(confirmed).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Second confirm: lazyRegion's resolved cache mounts it on the SAME flush,
    // no second import (the gate's "later ones mount synchronously" claim).
    let declined!: Promise<boolean>;
    act(() => {
      declined = askConfirm("Sure?");
    });
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Sure?");
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(declined).resolves.toBe(false);

    // The parameter body was never asked for until now.
    expect(loaded).toEqual(["ConfirmDialogBody"]);
    let params!: Promise<ParamValues | null>;
    act(() => {
      params = askParams("Smooth", [{ key: "n", label: "Window", type: "number", default: 5 }]);
    });
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Smooth");
    expect(loaded).toEqual(["ConfirmDialogBody", "ParamDialogBody"]);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await expect(params).resolves.toEqual({ n: 5 });

    let cancelled!: Promise<ParamValues | null>;
    act(() => {
      cancelled = askParams("Again", []);
    });
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Again");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(cancelled).resolves.toBeNull();
    expect(loaded).toEqual(["ConfirmDialogBody", "ParamDialogBody"]);
  });
});
