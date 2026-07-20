// Journey (residual #15 item) — annotation + shape create/move/edit/delete
// (GUI_INTERACTION_PLAN #15). NO undo coverage here — that's gated on the
// separate #1 owner decision (see README's Residuals section). Exercises the
// pointer-tool direct-manipulation bridge in lib/uplotOverlays.ts
// (annotationPlugin) / lib/uplotShapes.ts (shapesPlugin): real canvas hit-
// testing, a hand-rolled mousedown-based double-click detector (NOT a native
// `dblclick` listener — see useAnnotationEdit.ts / annotationPlugin's own
// doc for why: uPlot binds its own native dblclick-to-autoscale handler to
// the same element, so a second dblclick listener could race it), and native
// pointer capture across a drag gesture — exactly what
// useAnnotationEdit.test.ts / useShapeEdit.test.ts / uplotShapes.test.ts
// can't cover (they call the bridge callbacks or hit-test functions
// directly, never a real in-flight mousedown/mousemove/mouseup sequence on a
// live canvas).
//
// Anchor point: every canvas gesture below targets the data point (10, 10)
// on `linear-ramp.csv` (a monotonic 0..20 diagonal) via `.qzk-stage .u-over`'s
// geometric CENTER. curve-restyle.spec.ts leans on the SAME "symmetric data
// range -> canvas center" fact for its right-click, but that test's series-
// line hit test tolerates 44 px of error; an annotation dot's hit test is
// only 8 CANVAS px (annotationHit.ts's `hitTestAnnotationBody`) — too tight
// to trust uPlot's default auto-padding (empirically it pads the Y axis
// asymmetrically, e.g. rendering "0..22" for a 0..20 data range, which shifts
// data-value 10 well outside that tolerance). So every test below first pins
// EXPLICIT X/Y limits [0, 20] via the Inspector's Axes card (AxisLimits.tsx —
// the same UI path axis-title-limits.spec.ts drives) — a fixed `range` array
// replaces uPlot's padding function entirely (see uplotOpts.ts), making the
// data-to-pixel mapping exact.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface AnnotationSnapshot {
  id: string;
  x: number;
  y: number;
  text: string;
}
interface ShapeSnapshot {
  id: string;
  kind: string;
  dash?: boolean;
}

async function readAnnotations(page: Page): Promise<AnnotationSnapshot[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { annotations: AnnotationSnapshot[] } } } }).__qz
        .useApp.getState().annotations,
  );
}
async function readShapes(page: Page): Promise<ShapeSnapshot[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { shapes: ShapeSnapshot[] } } } }).__qz.useApp
        .getState().shapes,
  );
}
async function readSelectedAnnotationId(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { selectedAnnotationId: string | null } } } }).__qz
        .useApp.getState().selectedAnnotationId,
  );
}

/** Pin explicit X/Y axis limits [0, 20] via the Inspector's Axes card so the
 *  data-to-pixel mapping is exact (see the module doc) — the same
 *  AxisLimits.tsx fields axis-title-limits.spec.ts drives, in field order
 *  [xMin, xMax, yMin, yMax] (AxisLimits.tsx's `row()` calls, X then Y). */
async function pinAxisLimits(page: Page): Promise<void> {
  const axesCard = page.locator(".qz-card").filter({ has: page.locator("summary", { hasText: "Axes" }) });
  await axesCard.locator("summary").click();
  const fields = axesCard.getByPlaceholder("auto");
  await fields.nth(0).fill("0");
  await fields.nth(1).fill("20");
  await fields.nth(2).fill("0");
  await fields.nth(3).fill("20");
  await fields.nth(3).blur();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __qz: { useApp: { getState: () => { xLim: unknown; yLim: unknown } } };
            }
          ).__qz.useApp.getState().yLim,
      ),
    )
    .toEqual([0, 20]);
}

/** Plant one annotation at data coords (10, 10) via the Inspector's
 *  Annotations card (the deterministic, non-canvas creation path — see
 *  AnnotationsCard.tsx) and return the plot canvas's center point, which
 *  — with axis limits pinned via `pinAxisLimits` — coincides EXACTLY with
 *  that data point. */
async function createAnchoredAnnotation(
  page: Page,
  text: string,
): Promise<{ x: number; y: number }> {
  const annotationsCard = page
    .locator(".qz-card")
    .filter({ has: page.locator("summary", { hasText: "Annotations" }) });
  await annotationsCard.locator("summary").click();
  // `getByPlaceholder` substring-matches case-insensitively by default —
  // "label text" contains an "x", so plain "X"/"Y" need `exact` to avoid
  // also matching the text field.
  await annotationsCard.getByPlaceholder("X", { exact: true }).fill("10");
  await annotationsCard.getByPlaceholder("Y", { exact: true }).fill("10");
  await annotationsCard.getByPlaceholder("label text").fill(text);
  await annotationsCard.getByRole("button", { name: "Add" }).click();
  await expect.poll(async () => (await readAnnotations(page)).length).toBeGreaterThan(0);

  const box = (await page.locator(".qzk-stage .u-over").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("Annotation lifecycle @core", () => {
  test("create, edit text via double-click, move via drag, delete via the right-click object menu", async ({
    page,
  }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);
    await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
    await pinAxisLimits(page);

    const center = await createAnchoredAnnotation(page, "Peak A");
    const annotations = await readAnnotations(page);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ x: 10, y: 10, text: "Peak A" });
    const id = annotations[0].id;

    // ── Edit text: double-click the dot (the plugin's own hand-rolled
    //    double-mousedown detector — Playwright's dblclick() sends the same
    //    two-mousedown-same-target sequence it listens for) opens the
    //    RichLabelInput text dialog.
    //
    //    A PRIMING single click first is required: the very first click on
    //    an annotation calls the bridge's onSelect, which changes
    //    `selectedAnnotationId` in the store — a state change
    //    useAnnotationEdit's bridge depends on, which rebuilds the uPlot
    //    plugin instance (fresh `lastClickId`/`lastClickTime` closure
    //    state). A cold dblclick's SECOND mousedown can race that rebuild
    //    and land on the fresh instance, which has no memory of the first
    //    click, so it reads as two independent selects rather than a
    //    double-click (confirmed empirically). Clicking once first lets
    //    that rebuild settle — the annotation is already selected, so a
    //    same-value `setSelectedAnnotationId` is a no-op re-render, and the
    //    following real double-click lands on a stable plugin instance. ──
    await page.mouse.click(center.x, center.y);
    await page.mouse.dblclick(center.x, center.y);
    const dialog = page.locator(".qz-dialog", { hasText: "Edit annotation text" });
    await expect(dialog).toBeVisible();
    const textField = dialog.getByPlaceholder("label text");
    await textField.fill("Peak A (renamed)");
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await readAnnotations(page)).find((a) => a.id === id)?.text)
      .toBe("Peak A (renamed)");

    // ── Move: drag from the dot to a new canvas position; the annotation
    //    is still at its original (10, 10) anchor (the text edit above only
    //    touched `text`), so `center` is still the right drag origin. ─────
    const moved = { x: center.x + 50, y: center.y - 40 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(moved.x, moved.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const a = (await readAnnotations(page)).find((x) => x.id === id);
        return a && (a.x !== 10 || a.y !== 10);
      })
      .toBe(true);

    // ── Delete via the right-click object menu, at the NEW (moved)
    //    position — "Delete" is a danger entry with NO confirm step (cheap
    //    to recreate — see annotationShapeActions.ts's annotationDeleteAction). ──
    await page.mouse.move(moved.x, moved.y);
    await page.mouse.click(moved.x, moved.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect.poll(async () => readAnnotations(page)).toEqual([]);
  });

  test("select via a plain click, delete via the selection mini-toolbar", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);
    await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
    await pinAxisLimits(page);

    const center = await createAnchoredAnnotation(page, "Peak B");
    const id = (await readAnnotations(page))[0].id;

    // A plain click (mousedown+mouseup with ~0 movement) selects without
    // starting a move gesture — see annotationPlugin's mousedown handler.
    await page.mouse.click(center.x, center.y);
    await expect.poll(() => readSelectedAnnotationId(page)).toBe(id);

    const toolbar = page.getByRole("toolbar", { name: "Selected object actions" });
    await expect(toolbar).toBeVisible();
    // GUI_INTERACTION #17 fixed the layout squeeze this journey used to work
    // around: the floating plot toolbar (`.qzk-float-tools`, top-center) can
    // span nearly the full stage width at this viewport, and used to paint
    // over the mini-toolbar's top-left slot (shell.css's `.qzk-mini-toolbar`
    // now sits below the toolbar's row instead of sharing ToolHud's exact
    // `top: 12px`) — Playwright's own actionability diagnostic used to catch
    // the Analyze tool group intercepting the pointer at the Delete button's
    // coordinates. A real click now lands correctly.
    await toolbar.getByRole("button", { name: "Delete", exact: true }).click();

    await expect.poll(async () => readAnnotations(page)).toEqual([]);
    await expect.poll(() => readSelectedAnnotationId(page)).toBeNull();
  });
});

test.describe("Shape lifecycle @core", () => {
  test("draw a rectangle, toggle Dashed via its object menu, delete it", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);
    const plotOver = page.locator(".qzk-stage .u-over");
    await expect(plotOver).toBeVisible();

    // ── Arm the rectangle tool from the Annotate group's shape-dock flyout.
    //    The shape dock is now a SPLIT button: the main button repeats the
    //    last-used tool (its aria-label is dynamic, "Draw Rectangle" etc.),
    //    and the arrow button "Choose drawing tool" opens the picker flyout
    //    (lib/plotToolbarDefs.ts's SHAPE_TOOLS — glyph + label, e.g.
    //    "▭  Rectangle"; the flyout item carries a `checked` state, so it
    //    renders role="menuitemcheckbox", not "menuitem"). ─────────────────
    await page.getByRole("button", { name: "Choose drawing tool" }).click();
    await page.getByRole("menuitemcheckbox", { name: /Rectangle/ }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __qz: { useApp: { getState: () => { drawShapeKind: string | null } } } }).__qz
              .useApp.getState().drawShapeKind,
        ),
      )
      .toBe("rect");

    // ── Drag a diagonal on the canvas to draw it. ───────────────────────
    const box = (await plotOver.boundingBox())!;
    const p1 = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    const p2 = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 };
    await page.mouse.move(p1.x, p1.y);
    await page.mouse.down();
    await page.mouse.move(p2.x, p2.y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await readShapes(page)).length).toBe(1);
    const shapes = await readShapes(page);
    expect(shapes[0].kind).toBe("rect");
    const id = shapes[0].id;
    // Draw mode auto-returns to the Pointer tool + selects the new shape
    // (useShapeDraw.ts's onDrawCommit) — no separate "arm pointer" step
    // needed before the right-click below.

    // ── Right-click inside the rectangle's interior (a real AREA hit test,
    //    `pointInRect` — far more forgiving than the annotation dot's 8px
    //    tolerance) to open its object menu; toggle "Dashed". ─────────────
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    await page.mouse.click(mid.x, mid.y, { button: "right" });
    const dashedItem = page.getByRole("menuitemcheckbox", { name: "Dashed" });
    await expect(dashedItem).toBeVisible();
    await dashedItem.click();
    await expect
      .poll(async () => (await readShapes(page)).find((s) => s.id === id)?.dash)
      .toBe(true);

    // ── Delete via the same object menu. ────────────────────────────────
    await page.mouse.click(mid.x, mid.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect.poll(async () => readShapes(page)).toEqual([]);
  });
});
