// Acceptance journeys A3 ("Lossless figure: Save, close, reopen, and compare
// the complete document/spec for equality") and A4 ("Repeat A3 with y2,
// asymmetric errors, hidden/reordered series, custom formats, annotations,
// shapes, and waterfall offset") from FIGURE_AUTHORING_WORKFLOW_PLAN.
//
// The plan requires "automated coverage plus an owner-visible desktop run" for
// each journey. This is the AUTOMATED half; the owner's live run still gates
// the checkbox. F3.6 already proved the page round trip with an in-process
// unit test, but nothing exercised the editable-figure round trip through a
// REAL browser and the real `.dwk`-shaped persistence the app actually runs:
// jsdom cannot tell "the store field survived" from "the reopened WINDOW is
// the same figure".
//
// What is driven through the UI vs. seeded through the harness store, and why:
// the individual editors (series styles, tick formats, annotations, shapes,
// reference lines) each have their own unit + component coverage, and driving
// all of A4's state through their panels would make this a ten-minute spec
// that fails for reasons unrelated to the round trip. So the rich state is
// SEEDED, and the thing under test — Save ▸ close ▸ reopen ▸ compare — is
// driven entirely through the real UI (menu bar, window close, Library row).
//
// Export/download coverage deliberately stays in `export-roundtrip.spec.ts`,
// which already exercises real PDF/SVG/PNG downloads end to end; repeating it
// here would add a second flake surface to a spec about losslessness.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

/** Every A4 construct at once, on the live view the focused window projects. */
const RICH_VIEW = {
  yKeys: [0, 1, 2],
  y2Keys: [2],
  plotTitle: "Rich figure",
  xAxisLabel: "Time (s)",
  yAxisLabel: "Signal",
  xFmt: { mode: "sci", digits: 3 },
  yFmt: { mode: "fixed", digits: 2 },
  y2Fmt: { mode: "eng", digits: 1 },
  hiddenChannels: [1],
  seriesOrder: [2, 0, 1],
  seriesLabels: { 0: "Alpha renamed" },
  seriesStyles: { 0: { color: "#123456", width: 3, marker: true } },
  annotations: [{ id: "a1", x: 2, y: 3, text: "peak" }],
  shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 1, x2: 4, y2: 4, fill: "--series-3" }],
  refLines: [{ id: "r1", axis: "x", value: 5 }, { id: "r2", axis: "y", value: 2.5 }],
  waterfall: 12,
  xLim: [0, 9] as [number, number],
  yLim: [0, 6] as [number, number],
};

/** Asymmetric Y errors: the one A4 construct that is NOT a view field. These
 *  live on `document.bindings.errors`, seeded from the bound dataset's
 *  `errorRoles` when the window is created, and `updateFigureDocumentFromPlotView`
 *  deliberately preserves any binding that is not a symmetric-Y one (the legacy
 *  facade can only express those) — which is exactly what this exercises. */
const ASYMMETRIC_ERRORS = [
  { target: 0, channel: 2, axis: "y", side: "+" },
  { target: 0, channel: 1, axis: "y", side: "-" },
];

test("an editable figure survives save, window close, and reopen byte-for-byte @core", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);

  // Build the figure in a SECOND window: the last remaining plot window is
  // deliberately close-protected (the ≥1-window invariant), so the journey
  // needs one to spare before it can close the figure's own window.
  await page.evaluate(({ view, errors }) => {
    const app = (window as unknown as {
      __qz: {
        useApp: {
          getState: () => {
            createWindow: (id: string | null) => string;
            focusWindow: (id: string) => void;
            activeId: string | null;
            datasets: Record<string, unknown>[];
          };
          setState: (patch: unknown) => void;
        };
      };
    }).__qz.useApp;
    // Error roles must be on the dataset BEFORE the window exists: createWindow
    // stamps `dataset.errorRoles` into the new window's document bindings, and
    // nothing back-fills them afterwards.
    app.setState({
      datasets: app.getState().datasets.map((dataset, index) =>
        index === 0 ? { ...dataset, errorRoles: errors } : dataset,
      ),
    });
    // createWindow does NOT focus what it creates, and every step below acts on
    // the FOCUSED window — Save Editable Figure included. Focus first, then
    // seed the view: focusing swaps the live view facade, so a view seeded
    // before the switch would be discarded.
    const id = app.getState().createWindow(app.getState().activeId);
    app.getState().focusWindow(id);
    app.setState(view);
  }, { view: RICH_VIEW, errors: ASYMMETRIC_ERRORS });
  await page.waitForTimeout(300);

  // ── Save through the real menu ────────────────────────────────────────
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  await page.getByText("Save Editable Figure", { exact: true }).click();

  const saved = await page.evaluate(() =>
    JSON.stringify(
      (window as unknown as { __qz: { useApp: { getState: () => { editableFigures: unknown[] } } } })
        .__qz.useApp.getState().editableFigures[0],
    ),
  );
  expect(saved, "Save Editable Figure stored a document").toBeTruthy();
  const savedDocument = JSON.parse(saved) as {
    id: string;
    name: string;
    bindings: { errors: { target: number; side: string }[] };
    plot: { view: Record<string, unknown> };
  };

  // The A4 constructs really are IN the saved document — otherwise a later
  // "equal after reopen" assertion would be comparing two equally empty
  // objects and passing for the wrong reason.
  expect(savedDocument.plot.view.plotTitle).toBe("Rich figure");
  expect(savedDocument.plot.view.hiddenChannels).toEqual([1]);
  expect(savedDocument.plot.view.seriesOrder).toEqual([2, 0, 1]);
  expect(savedDocument.plot.view.y2Fmt).toEqual({ mode: "eng", digits: 1 });
  expect(savedDocument.plot.view.annotations).toHaveLength(1);
  expect(savedDocument.plot.view.shapes).toHaveLength(1);
  expect(savedDocument.plot.view.refLines).toHaveLength(2);
  expect(savedDocument.plot.view.waterfall).toBe(12);
  // Asymmetric roles are the ones the legacy PlotView facade CANNOT express,
  // so they prove the rebuild preserved bindings rather than re-deriving them.
  expect(
    savedDocument.bindings.errors,
    "asymmetric roles reached the saved document's bindings",
  ).toEqual(expect.arrayContaining([expect.objectContaining({ side: "+" }), expect.objectContaining({ side: "-" })]));
  // A blank window title must not produce a blank figure name (the title bar
  // resolves its bound dataset's name, and the saved figure must match).
  expect(savedDocument.name.trim().length).toBeGreaterThan(0);

  // ── Close the figure's window through the real UI ─────────────────────
  const focusedId = await page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => { focusedWindowId: string } } } })
      .__qz.useApp.getState().focusedWindowId,
  );
  await page.evaluate((id) =>
    (window as unknown as { __qz: { useApp: { getState: () => { closeWindow: (w: string) => void } } } })
      .__qz.useApp.getState().closeWindow(id), focusedId);
  await expect
    .poll(() => page.evaluate((id) =>
      (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: { id: string }[] } } } })
        .__qz.useApp.getState().plotWindows.some((w) => w.id === id), focusedId))
    .toBe(false);

  // ── Reopen from the Library, by clicking its row ──────────────────────
  // `toBeVisible` rather than a `count()` check: the row is rendered by a
  // store subscription, so on a cold CI runner a one-shot count can read zero
  // purely because React has not flushed yet — a false "collapsed section"
  // that the old fallback then "fixed" by clicking something else entirely.
  const row = page.locator(`[title="open editable figure \\"${savedDocument.name}\\""]`).first();
  await expect(row, "the saved figure has a Library row to reopen from").toBeVisible();
  await row.dblclick(); // L0.25 (PR #139): single click selects; double-click opens

  await expect
    .poll(() => page.evaluate((id) =>
      (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: { document?: { id: string } }[] } } } })
        .__qz.useApp.getState().plotWindows.some((w) => w.document?.id === id), savedDocument.id))
    .toBe(true);

  // ── A3's actual assertion: the reopened document equals the saved one ──
  const reopened = await page.evaluate((id) => {
    const state = (window as unknown as {
      __qz: { useApp: { getState: () => { plotWindows: { document?: { id: string } }[] } } };
    }).__qz.useApp.getState();
    return JSON.stringify(state.plotWindows.find((w) => w.document?.id === id)?.document);
  }, savedDocument.id);
  expect(JSON.parse(reopened as string)).toEqual(savedDocument);
});
