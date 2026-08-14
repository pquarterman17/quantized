// Acceptance journey A1 ("Arbitrary data: Drop/import data, confirm inferred
// roles, and reach a production-quality editable plot without code") from
// FIGURE_AUTHORING_WORKFLOW_PLAN's "Required acceptance journeys" section.
// This is the AUTOMATED half — the owner's live desktop run still gates the
// checkbox, exactly like A3/A4/A5.
//
// "Arbitrary data" = a file that is NOT one of the app's known instrument
// formats. `import_csv`/`io/registry.py` sniff specific instruments (Bruker,
// XRDML, Origin, …); a plain delimited text file with a header row, a units
// row, and no instrument fingerprint falls through to the generic delimited
// path with zero technique-specific defaults (`techniqueOf` tags it
// "generic") — `fixtures/arbitrary-lab-log.csv` is exactly that: a
// hand-written CSV no parser in the registry claims by content-sniffing.
//
// WHERE "confirm inferred roles" REALLY LIVES — investigated, not assumed:
// a plain Library drag-and-drop (`import-drop.spec.ts`) shows no
// confirmation step at all; `addFromPayload` (`store/importDatasets.ts`)
// silently defaults every non-x column to a plotted Y channel and imports
// immediately. The Inspector's Channels card (`Inspector/ChannelsCard.tsx`)
// is real but it is a POST-import adjustment surface, not a confirmation
// gate — nothing pauses there for approval. The one surface that actually
// shows the app's GUESS and blocks on user confirmation before any data
// lands is the **Import wizard** (`ImportWizardPanel.tsx`, commands/
// fileCommands.ts's "Import wizard (guided preview + saved filters)…"):
// `POST /api/import/guess` (`io/import_preview.py::guess_settings`) proposes
// a delimiter, header/units line, and a per-column role — x / y / error /
// label / ignore (`io.import_preview.DATA_ROLES`) — and `PreviewTable.tsx`
// renders that guess live, editable, before "Import" does anything. This
// spec drives THAT surface, then checks the guess landed correctly in the
// two things downstream of it: the Inspector's Channels card (which channels
// exist to configure at all) and the live Stage legend (what actually got
// plotted) — literally "the path between import and the Channels card".
//
// THE FIXTURE'S DELIBERATE WRONG GUESS: `guess_settings` has no semantic
// column-role inference — it always proposes `["x"] + ["y"] * (n-1)`
// (verified directly against `/api/import/guess` before writing this spec).
// `arbitrary-lab-log.csv` has a 4th numeric column, "Flag" (a QC flag, no
// physical unit), that the guess defaults to "y" — a wrong plotted channel a
// naive "just click Import" pass would leave in a "production-quality"
// figure. Confirming the guess here means recognizing that and fixing it to
// "ignore" in the wizard BEFORE import, which is what actually produces a
// clean 2-series figure (Signal A, Signal B vs Time) instead of a spurious
// third line — the concrete stakes "confirm inferred roles" names.
//
// PRODUCTION-QUALITY BASICS, and how each is verified without OCR:
//  - correct series count: `.qzk-legend .it` row count on the LIVE Stage
//    plot (real interactive plot, not a screenshot) — 2, not 3.
//  - axis/series labels carry the fixture's headers+units: the Stage
//    legend's rendered text is `${label} (${unit})` verbatim
//    (`PlotLegend.tsx`'s `defaultLabel`), asserted directly on real DOM; the
//    X axis label is verified the same way A5 verifies text baked into a
//    render — matplotlib's SVG writer embeds a text artist's source string
//    as an XML comment immediately before its glyph paths even under
//    `svg.fonttype: path` (re-confirmed here for AXIS labels specifically,
//    independently, via a direct `/api/export/figure` probe against this
//    exact fixture's shape before this spec was written: the exported SVG's
//    raw bytes contain `<!-- Time (s) -->`, `<!-- Signal A (V) -->`, and
//    `<!-- Signal B (V) -->` as literal substrings).
//  - a successful publication-preview render: the real
//    `/api/export/figure-hitmap` request (same technique as
//    group-facet-journey.spec.ts's `figureHitmapRequest`) carries the
//    confirmed channel set (`y_keys: [0, 1]`, no stray Flag channel), and
//    the preview's OWN hitmap element list — not an assumption about the
//    image — renders exactly 2 `series:N` hitboxes.
//
// Real UI throughout — no harness store SEEDING anywhere in this spec (only
// read-only `window.__qz` state reads for assertions, the same convention
// A3/A4/A5 use). The file itself reaches the wizard via a real
// `<input type="file">` `setInputFiles` call — the standard Playwright
// substitute for an OS file-picker dialog (which no automation framework can
// drive directly); every subsequent step is a real click/select on rendered
// UI.

import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface FigureRequestBody {
  x_key?: number;
  y_keys?: number[];
}

/** Mirrors `io.import_preview.guess_settings`'s ALWAYS guess for a plain
 *  file: first column x, every other column y. Column 4 ("Flag") is the
 *  deliberately-wrong one this journey confirms-and-corrects. */
const GUESSED_COLUMNS: { name: string; unit: string; role: string }[] = [
  { name: "Time", unit: "s", role: "x" },
  { name: "Signal A", unit: "V", role: "y" },
  { name: "Signal B", unit: "V", role: "y" },
  { name: "Flag", unit: "", role: "y" },
];

function importWizardWindow(page: Page): Locator {
  return page.locator(".qzk-win").filter({ has: page.getByText("Import wizard", { exact: true }) });
}

function publicationPreviewWindow(page: Page): Locator {
  return page.locator(".qzk-win").filter({ has: page.getByText(/^Publication preview —/) });
}

function figureHitmapRequest(page: Page) {
  return page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname === "/api/export/figure-hitmap",
  );
}

test("importing an arbitrary CSV confirms the guessed roles and reaches a clean, exportable plot", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);

  // ── Open the Import wizard (real UI — the command hint every failed
  //    import already points at: "try the Import wizard (⌘K → Import
  //    wizard…)", store/importDatasets.ts) ──────────────────────────────────
  await runPaletteCommand(page, "Import wizard");
  const wizard = importWizardWindow(page);
  await expect(wizard).toBeVisible();

  // ── Pick the fixture through a real file input (Playwright's documented
  //    stand-in for an OS file-picker dialog — no automation framework can
  //    drive a native dialog directly) — wait for the GUESS to actually
  //    reach the wizard's live preview, not a fixed delay. ─────────────────
  const previewResponse = page.waitForResponse((r) =>
    r.request().method() === "POST" && new URL(r.url()).pathname === "/api/import/preview",
  );
  await wizard.locator('input[type="file"]').setInputFiles(fixturePath("arbitrary-lab-log.csv"));
  await previewResponse;

  // ── Confirm the guess IS what the import UI presents, before touching
  //    anything — asserted against the real rendered fields, one column at a
  //    time, by the same 1-indexed aria-labels PreviewTable.tsx renders. ───
  for (const [i, col] of GUESSED_COLUMNS.entries()) {
    const n = i + 1;
    await expect(wizard.getByLabel(`column ${n} name`, { exact: true })).toHaveValue(col.name);
    await expect(wizard.getByLabel(`column ${n} unit`, { exact: true })).toHaveValue(col.unit);
    await expect(wizard.getByLabel(`column ${n} role`, { exact: true })).toHaveValue(col.role);
  }

  // ── Correct the one wrong guess: "Flag" is a QC flag, not a measurement —
  //    reassign column 4 from the guessed "y" to "ignore" (real <select>
  //    commit, not a fired change event). This is the "confirm inferred
  //    roles" gesture the journey is actually about. ─────────────────────────
  await wizard.getByLabel("column 4 role", { exact: true }).selectOption("ignore");
  await expect(wizard.getByLabel("column 4 role", { exact: true })).toHaveValue("ignore");

  // ── Import (real UI) — lands via the SAME `addDataset` chokepoint a plain
  //    drop uses, so it auto-activates and plots into the focused window
  //    exactly like import-drop.spec.ts's journey. ───────────────────────────
  const parseResponse = page.waitForResponse((r) =>
    r.request().method() === "POST" && new URL(r.url()).pathname === "/api/import/parse",
  );
  await wizard.getByRole("button", { name: "Import", exact: true }).click();
  await parseResponse;

  await waitForDatasetCount(page, 1);
  await expect(page.locator("[data-ds-id]").first()).toContainText("arbitrary-lab-log");

  // ── The confirmed roles really did land correctly: exactly 2 channels
  //    (Signal A, Signal B) — "Flag" is not merely hidden, it was never
  //    parsed into the dataset at all (`io.import_preview.parse_import` only
  //    emits x/y/error-role columns as channels). ────────────────────────────
  const labels = await page.evaluate(
    () =>
      (
        window as unknown as {
          __qz: { useApp: { getState: () => { datasets: { data: { labels: string[]; units: string[] } }[] } } };
        }
      ).__qz.useApp.getState().datasets[0].data.labels,
  );
  expect(labels).toEqual(["Signal A", "Signal B"]);

  // ── Reached a production-quality editable plot, through real UI: the live
  //    interactive Stage canvas, not a static preview. ───────────────────────
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  // Series count + labels carrying the fixture's headers/units, straight off
  // the real DOM legend (PlotLegend.tsx's `defaultLabel`: `"${label} (${unit})"`).
  const legendRows = page.locator(".qzk-legend .it");
  await expect(legendRows).toHaveCount(2);
  await expect(legendRows.nth(0)).toContainText("Signal A (V)");
  await expect(legendRows.nth(1)).toContainText("Signal B (V)");

  // ── The Inspector's Channels card — the OTHER end of "between import and
  //    the Channels card" — reflects the same confirmed, 2-channel state:
  //    expand it (a collapsed `<details>` by default, same disclosure-widget
  //    interaction axis-title-limits.spec.ts exercises) and count real
  //    checkbox rows, not an assumption from the legend alone. ───────────────
  // exact match on the HEADING span, not the `<summary>` — Card.tsx's own
  // comment warns the `<summary>`'s full text content is "Channels?" (the
  // help button's decorative "?" is a text sibling of the heading span), so
  // matching must target `.qz-card-heading` specifically (also sidesteps
  // "Channel statistics", a second card whose title starts with the same
  // word). The `.filter({ has })` locator is UNPREFIXED (`.qz-card-heading`,
  // not `.qzk-inspector .qz-card-heading`) — Playwright resolves `has` as a
  // descendant search rooted at each candidate, so a `.qzk-inspector`-
  // prefixed `has` locator would require a SECOND nested `.qzk-inspector`
  // inside the card and match nothing (reproduced standalone before landing
  // this fix: prefixed → 0 matches, unprefixed → 1).
  const channelsCard = page.locator(".qzk-inspector .qz-card").filter({
    has: page.locator(".qz-card-heading", { hasText: /^Channels$/ }),
  });
  await channelsCard.locator(".qz-card-heading").click();
  await expect(channelsCard).toBeVisible();
  // The X-axis select shows the auto default ("" sentinel) — Time was never
  // overridden, its guessed "x" role was already correct and needed no fix.
  await expect(channelsCard.locator("select").first()).toHaveValue("");
  const channelCheckboxes = channelsCard.locator('input[type="checkbox"]');
  await expect(channelCheckboxes).toHaveCount(2); // Flag has no row at all
  await expect(channelCheckboxes.nth(0)).toBeChecked();
  await expect(channelCheckboxes.nth(1)).toBeChecked();

  // The Import wizard is done (Import already landed the dataset) — close it
  // through its own real close button before moving on. Not optional
  // tidiness: every floating ToolWindow in this app opens at the SAME
  // default screen position (the exact fact group-facet-journey.spec.ts's
  // header documents for Graph Builder vs. Publication Preview), and left
  // open here it sits UNDER where the command palette's filtered list
  // renders — reproduced directly: a real click on the palette's
  // "Publication preview…" row timed out with Playwright's own diagnostic
  // "<div title=\"header line\"> … subtree intercepts pointer events",
  // `title="header line"` being the wizard's raw-lines strip (PreviewTable.tsx).
  await wizard.getByTitle("Close", { exact: true }).click();
  await expect(wizard).toBeHidden();

  // ── A successful publication-preview render (real UI, real backend): the
  //    request that actually reaches the renderer carries the confirmed
  //    channel set, and the preview's own hitmap proves 2 series drew — not
  //    an assumption about the resulting image. ──────────────────────────────
  const hitmapReq = figureHitmapRequest(page);
  await runPaletteCommand(page, "Publication preview");
  const hitmapBody = (await hitmapReq).postDataJSON() as FigureRequestBody;
  expect(hitmapBody.x_key, "x_key omitted — Time's auto default was confirmed, not overridden").toBeUndefined();
  expect(hitmapBody.y_keys, "no stray Flag channel reached the render").toEqual([0, 1]);

  const preview = publicationPreviewWindow(page);
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-element^="series:"]')).toHaveCount(2);

  // ── Real vector export — the labels survive the FULL pipeline, not just
  //    the client legend. Same matplotlib SVG-comment technique
  //    group-facet-journey.spec.ts uses for series text, re-verified here for
  //    AXIS text (see header) via a direct backend probe before this spec was
  //    written. ─────────────────────────────────────────────────────────────
  await preview.locator("select").first().selectOption("svg");
  const download = page.waitForEvent("download");
  const exportResponse = page.waitForResponse((r) =>
    r.request().method() === "POST" && new URL(r.url()).pathname === "/api/export/figure",
  );
  await preview.getByRole("button", { name: "Export SVG" }).click();
  const [response, file] = await Promise.all([exportResponse, download]);
  expect(response.ok()).toBe(true);
  const path = await file.path();
  expect(path).not.toBeNull();
  const svg = (await readFile(path!)).toString("utf8");
  expect(svg.slice(0, 200)).toContain("<svg");
  for (const label of ["Time (s)", "Signal A (V)", "Signal B (V)"]) {
    expect(svg, `exported SVG carries "${label}" (fixture header + unit)`).toContain(label);
  }
});
