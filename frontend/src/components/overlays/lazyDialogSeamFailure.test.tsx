// Load-failure contract for the two lazy promise dialogs of bundle diet slice
// 8 (plans/BUNDLE_HEADROOM.md; the seams themselves are pinned in
// lazyDialogSeams.test.tsx). A chunk that will not load must:
//   1. not unmount the React root (UX-003: the gate only mounts a body whose
//      chunk has already loaded, via lazyRegion's tagged `preload()`, so a
//      failure is a rejected promise and never a throw during render);
//   2. SETTLE the pending ask with its cancel value (`false` / `null`), so
//      the awaiting command neither hangs nor runs a destructive action
//      behind a dialog nobody saw;
//   3. say so (a danger toast);
//   4. retry on the next ask rather than replaying the cached rejection.
// Each body's module factory below throws while its `fail` flag is set, which
// is exactly what a failed chunk fetch looks like to the gate's `import()`.

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";
import ParamDialog, { askParams } from "./ParamDialog";
import type { ParamValues } from "../../lib/params";
import { useToasts } from "../../store/toasts";
// Warm the bodies' dependencies (never the bodies -- their mocks below must
// run on the gate's own import()), so the retry waits on the body alone, not
// on a cold transform of `lib/escapeStack`'s store graph (~2 s measured).
import "../primitives";
import "./ParamFields";
import "./useDialogFocus";
import "../../lib/escapeStack";

const { fail } = vi.hoisted(() => ({ fail: { confirm: true, params: true } }));
vi.mock("./ConfirmDialogBody", async (importOriginal: () => Promise<Record<string, unknown>>) => {
  if (fail.confirm) throw new Error("chunk fetch failed");
  return await importOriginal();
});
vi.mock("./ParamDialogBody", async (importOriginal: () => Promise<Record<string, unknown>>) => {
  if (fail.params) throw new Error("chunk fetch failed");
  return await importOriginal();
});

// Captured, not merely silenced: see the afterEach assertion.
let errorSpy: MockInstance;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  // Nothing reached a React error boundary or an uncaught-error log: the
  // failure stayed a handled promise rejection all the way.
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

/** Drain the rejection's follow-up work (the cancel's re-render, any
 *  boundary retry), so the "root survives" assertions run after every point
 *  where a failed load could have unmounted it, not before. */
const flushRejection = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger");

describe("a lazy promise dialog whose chunk fails to load", () => {
  it("confirm: the root survives, the ask settles false, a toast says why, and the next ask retries", async () => {
    render(
      <>
        <p>the rest of the app</p>
        <ConfirmDialog />
      </>,
    );
    let answer!: Promise<boolean>;
    act(() => {
      answer = askConfirm("Delete it?", "no undo", "Delete", true);
    });
    await expect(answer).resolves.toBe(false);
    await flushRejection();
    expect(screen.getByText("the rest of the app")).toBeInTheDocument();
    expect(dangerToasts().map((t) => t.msg)).toEqual([
      "The confirmation dialog failed to load, so nothing was changed. Try again.",
    ]);

    // The chunk is reachable again: the next ask mounts a FRESH region (the
    // failed one unmounted when the ask closed) and gets a real dialog.
    fail.confirm = false;
    let retried!: Promise<boolean>;
    act(() => {
      retried = askConfirm("Delete it?", "no undo", "Delete", true);
    });
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Delete it?");
    act(() => screen.getByRole("button", { name: "Delete" }).click());
    await expect(retried).resolves.toBe(true);
  });

  it("params: the ask settles null (the cancel every caller handles) and the next ask retries", async () => {
    render(
      <>
        <p>the rest of the app</p>
        <ParamDialog />
      </>,
    );
    let values!: Promise<ParamValues | null>;
    act(() => {
      values = askParams("Rename", [{ key: "name", label: "Name", type: "text", default: "a" }]);
    });
    await expect(values).resolves.toBeNull();
    await flushRejection();
    expect(screen.getByText("the rest of the app")).toBeInTheDocument();
    expect(dangerToasts().map((t) => t.msg)).toEqual([
      "The dialog failed to load, so the action was cancelled. Try again.",
    ]);

    fail.params = false;
    let retried!: Promise<ParamValues | null>;
    act(() => {
      retried = askParams("Rename", [{ key: "name", label: "Name", type: "text", default: "a" }]);
    });
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Rename");
    act(() => screen.getByRole("button", { name: "Run" }).click());
    await expect(retried).resolves.toEqual({ name: "a" });
  });
});
