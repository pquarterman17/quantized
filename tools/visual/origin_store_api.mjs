// The harness's ONLY contact surface with the app store (`window.__qz.useApp`,
// exposed by frontend/src/main.tsx under `?harness=1`).
//
// Why this file exists: origin_figures.mjs once injected datasets and called
// `addOriginFigures(stem, figures, ids)` itself; PR #643 changed that action's
// signature and the harness threw `TypeError ... 'layer'` for weeks, unnoticed
// (a figure-import regression slipped through meanwhile). The harness now
// drives the SAME path the real UI uses -- `importFiles` on a File taken from
// an <input type=file>, then `applyOriginFigure` per figure -- and every store
// action it touches is declared in STORE_CONTRACT, which
// frontend/src/test/originHarnessContract.test.ts checks against the real store.
//
// Puppeteer-free at import time: functions take an already-open `page`.

/** Store actions the harness calls, with the max arity it relies on. */
export const STORE_CONTRACT = Object.freeze({
  importFiles: 2, // (files: File[], { bypassGuard })
  applyOriginFigure: 2, // (entryId, { discardConfirmed })
});

/** Options the harness passes; the contract test applies a figure with these too. */
export const IMPORT_OPTS = Object.freeze({ bypassGuard: true });
export const APPLY_OPTS = Object.freeze({ discardConfirmed: true });

/** Import `opjPath` through the real `importFiles` upload path. Returns the new dataset ids. */
export async function importProjectViaUi(page, opjPath) {
  await page.evaluate(() => {
    document.getElementById("qzup")?.remove();
    const input = document.createElement("input");
    input.type = "file";
    input.id = "qzup";
    document.body.appendChild(input);
  });
  await collapsePanels(page);
  const input = await page.$("#qzup");
  await input.uploadFile(opjPath);
  return page.evaluate(async (opts, path) => {
    const files = [...document.getElementById("qzup").files];
    // Chrome leaves the input empty, with no error, when it cannot open the
    // path (a non-ASCII name under a POSIX locale: origin_shared.chromeEnv).
    // Importing nothing would report every page as a missing entry instead.
    if (files.length === 0) throw new Error(`the browser could not open ${path} for upload`);
    const ids = await window.__qz.useApp.getState().importFiles(files, opts);
    return ids ?? [];
  }, IMPORT_OPTS, opjPath);
}

/** Collapse the Library + Inspector so the plot stage gets the width. The
 *  store has only `toggleLeft`/`toggleRight` (no setters -- the old optional
 *  `setLeftCollapsed?.()` calls here were silent no-ops), so set the two
 *  layout flags directly; importing a project re-opens them, so callers
 *  repeat this after an import settles. */
export async function collapsePanels(page) {
  await page.evaluate(() => window.__qz.useApp.setState({ leftCollapsed: true, rightCollapsed: true }));
}

/** Library figure entries (+ dataset names/folders) the import produced. */
export async function readFigureEntries(page) {
  return page.evaluate(() => {
    const s = window.__qz.useApp.getState();
    return {
      entries: s.originFigures,
      datasetInfo: Object.fromEntries(
        s.datasets.map((d) => [
          d.id,
          { name: d.name, folder: (d.data.metadata || {}).origin_folder_path ?? null },
        ]),
      ),
    };
  });
}

/** Apply one figure entry exactly like a Library click, then wait for any lazy load. */
export async function applyFigure(page, entryId) {
  await page.evaluate(
    (id, opts) => window.__qz.useApp.getState().applyOriginFigure(id, opts),
    entryId,
    APPLY_OPTS,
  );
  for (let i = 0; i < 80; i += 1) {
    const busy = await page.evaluate(() =>
      window.__qz.useApp.getState().datasets.some((d) => d.pending?.loading),
    );
    await new Promise((r) => setTimeout(r, 250));
    if (!busy && i > 2) break;
  }
}
