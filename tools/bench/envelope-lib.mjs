// Shared helpers for frontend_envelope.mjs (PRIMARY_SOFTWARE_AUDIT_PLAN
// P0.4 — the browser-side half of the large-data/long-session performance
// envelope). Kept separate from the orchestration script so each case's
// control flow in frontend_envelope.mjs stays readable.
//
// Every measurement here drives the REAL app the way a user does — the
// Command Palette (⌘K → "Import data…" / "Open workspace…" / "Clear
// autosaved workspace…"), real Playwright mouse input on the real uPlot
// `.u-over` element, and the real IndexedDB the app's own autosave writes
// to. Nothing here monkeypatches `frontend/src` — the two spots that
// intercept a browser API (`URL.createObjectURL` for the .dwk save capture,
// `HTMLAnchorElement.prototype.click` to suppress the real download in
// headless Chrome) patch the PAGE's runtime from the outside, exactly the
// way a test harness stubs `fetch` — no repo source file is touched.

import { setTimeout as delay } from "node:timers/promises";

export function sleep(ms) {
  return delay(ms);
}

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function p95(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1);
  return s[idx];
}

/** Race `fn()` against a Node-side timer so one hung case (e.g. the browser
 *  main thread pegged rendering 7,000,000 points with no downsampling)
 *  cannot hang the whole harness run. Does not truly cancel `fn()` — Node
 *  has no such primitive across a CDP call — but lets the orchestrator
 *  record "unmeasured: timed out" and move on to the next case with a
 *  freshly launched browser. */
export async function withDeadline(fn, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Navigate to the app with the `?harness` seam (frontend/src/main.tsx —
 *  the SAME query param tools/visual and frontend/e2e use) and wait for the
 *  shell + `window.__qz.useApp` to be ready. */
export async function gotoHarness(page, baseUrl) {
  await page.goto(`${baseUrl}/?harness`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".qzk-library", { timeout: 20000 });
  await page.waitForFunction(() => Boolean(window.__qz && window.__qz.useApp), { timeout: 20000 });
}

/** CDP `Performance.getMetrics` JSHeapUsedSize, or null when unavailable. */
export async function jsHeapUsed(cdp) {
  try {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = metrics.find((x) => x.name === "JSHeapUsedSize");
    return m ? m.value : null;
  } catch {
    return null;
  }
}

/** Poll `page.locator(selector).count()` until it reaches at least
 *  `minCount`. "At least" rather than "equals" because a single imported
 *  file is not guaranteed to yield exactly one dataset row (e.g. a
 *  multi-book Origin project) — the loop that imports N files should not
 *  hang forever waiting for a count that can never exactly match. */
export async function waitForCountAtLeast(page, selector, minCount, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const count = await page.locator(selector).count();
    if (count >= minCount) return count;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${selector} count >= ${minCount} (last seen ${count})`);
    }
    await sleep(100);
  }
}

/** Time-to-first-paint proxy for the real uPlot canvas: samples pixels at a
 *  stride across every `.qzk-stage canvas` until one shows more than one
 *  distinct RGBA value (the same "painted variation" technique
 *  tools/visual/origin_figures.mjs uses for its structural report).
 *  Returns elapsed ms from the call, or throws on timeout. */
export async function waitForCanvasPaint(page, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    const painted = await page
      .evaluate(() => {
        const canvases = Array.from(document.querySelectorAll(".qzk-stage canvas"));
        if (canvases.length === 0) return false;
        return canvases.some((canvas) => {
          if (canvas.width <= 0 || canvas.height <= 0) return false;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return false;
          let data;
          try {
            data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          } catch {
            return false;
          }
          const stride = Math.max(4, Math.floor((canvas.width * canvas.height) / 2000) * 4);
          let first = null;
          for (let o = 0; o < data.length; o += stride) {
            const c = `${data[o]},${data[o + 1]},${data[o + 2]},${data[o + 3]}`;
            if (first == null) first = c;
            else if (c !== first) return true;
          }
          return false;
        });
      })
      .catch(() => false);
    if (painted) return Date.now() - start;
    if (Date.now() - start > timeoutMs) throw new Error("canvas never painted within timeout");
    await sleep(75);
  }
}

/** Wait two animation-frame ticks — the cheap "paint settled" proxy the
 *  P0.4 plan spec calls for (a full CDP paint-trace is overkill for a
 *  scripted bench and Chromium presents the frame between the two rAF
 *  callbacks in the overwhelming common case). */
async function doubleRAF(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
      }),
  );
}

/** Wall-clock ms from just before `fn()` dispatches one input step to two
 *  animation frames later, all on Node's own clock (avoids the
 *  process-relative `performance.now()` epoch mismatch between Node and the
 *  browser process — see the file-level doc). `fn()` should dispatch a
 *  SINGLE incremental input (one mousemove step, one wheel tick), not a
 *  whole gesture, so this approximates "did this one input get an
 *  acknowledged next-frame response" rather than a multi-step drag's total
 *  duration. */
export async function timedGesture(page, fn) {
  const t0 = Date.now();
  await fn();
  await doubleRAF(page);
  return Date.now() - t0;
}

/** Run ~10 pan increments (continuous drag) then ~10 zoom ticks (wheel) at
 *  the plot's center, each timed via `timedGesture`. Targets the REAL
 *  gesture handlers: `panPlugin` (frontend/src/lib/uplotTools.ts) listens
 *  for mousedown/mousemove/mouseup on `.u-over`; `wheelZoomPlugin` listens
 *  for `wheel` on the same element. Returns { panLatencies, zoomLatencies }
 *  (arrays of ms) or throws if the plot overlay isn't visible. */
export async function measureGestureLatencies(page, stageSelector = ".qzk-stage .u-over") {
  const box = await page.locator(stageSelector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${stageSelector} (plot not visible)`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const panLatencies = [];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 10; i++) {
    const dx = (i + 1) * 4;
    const dy = i % 2 === 0 ? 4 : -4;
    const t = await timedGesture(page, () => page.mouse.move(cx + dx, cy + dy));
    panLatencies.push(t);
  }
  await page.mouse.up();

  const zoomLatencies = [];
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 10; i++) {
    // Alternate zoom-in/zoom-out so the view doesn't run away to an
    // unrenderable extreme scale after 10 ticks — this is meant to measure
    // steady-state interaction latency, not a stress-zoom.
    const deltaY = i % 2 === 0 ? -120 : 100;
    const t = await timedGesture(page, () => page.mouse.wheel(0, deltaY));
    zoomLatencies.push(t);
  }
  return { panLatencies, zoomLatencies };
}

// ---- Command Palette driving (mirrors frontend/e2e/utils/palette.ts) ------
//
// Reimplemented standalone rather than imported: that file is TypeScript
// (frontend/e2e runs under @playwright/test's own transpiling test runner)
// and this is a plain Node ESM script with no TS loader. Same race this
// harness must dodge for the same reason (documented at length in the
// original): CommandPalette's open-effect is a PASSIVE effect that can
// still be re-running its `setQuery("")` reset after a scripted `fill()` —
// automation types far faster than the debounce a human would ever produce.

/** Open the palette, filter to `label`, and return the matching
 *  `.qz-cmdk-item` locator once visible — retrying the whole open/type
 *  cycle (closing first) until it appears. */
export async function openPaletteAndLocate(page, label, timeoutMs = 10000) {
  const start = Date.now();
  for (;;) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.keyboard.press("Control+k");
    await page
      .getByPlaceholder("Type a command…")
      .fill(label, { timeout: 2000 })
      .catch(() => {});
    const item = page.locator(".qz-cmdk-item", { hasText: label }).first();
    try {
      await item.waitFor({ state: "visible", timeout: 1500 });
      return item;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`palette command "${label}" never appeared within ${timeoutMs}ms`);
      }
    }
  }
}

/** Run a no-file-dialog palette command by label (e.g. "Clear autosaved
 *  workspace"). */
export async function runPaletteAction(page, label) {
  const item = await openPaletteAndLocate(page, label);
  await item.click();
}

/** Real import path (MAIN_PLAN #31's `chooseAndImport` browser-tab branch):
 *  Command Palette → "Import data…" → the hidden `<input type=file>`'s
 *  native file-chooser event, which Playwright intercepts. Uploads via
 *  `/api/parsers/upload` — the same route a user's drag/drop or file-picker
 *  import hits, never the path-based `/api/parsers/import`. */
export async function importFilesViaPalette(page, filePaths) {
  const item = await openPaletteAndLocate(page, "Import data");
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  await item.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(filePaths);
}

/** "Open workspace (.dwk)…" via the palette + intercepted file chooser.
 *  Caller is responsible for making sure no confirm-replace dialog is
 *  expected (i.e. the library is empty) — see fileCommands.ts's
 *  `openWorkspaceCommand`. */
export async function openWorkspaceViaPalette(page, dwkPath) {
  const item = await openPaletteAndLocate(page, "Open workspace");
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  await item.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(dwkPath);
}

/** Trigger the real "Save workspace (.dwk)…" command
 *  (store/workspaceIO.ts's `runSaveWorkspaceToFile`) and capture its Blob
 *  instead of letting headless Chrome attempt (and hang on, or silently
 *  drop) a real download. Patches `URL.createObjectURL` /
 *  `HTMLAnchorElement.prototype.click` INSIDE THE PAGE for the duration of
 *  one call, then restores them — this is a runtime stub the harness
 *  installs from outside, not an edit to `lib/download.ts`'s `saveBlob`.
 *  Returns { durationMs, text, size }: `durationMs` is measured entirely on
 *  the page's own `performance.now()` clock (both marks taken in the same
 *  `page.evaluate`, so there's no cross-process clock question), `text` is
 *  the serialized workspace (feed straight to `openWorkspaceViaPalette` via
 *  a temp file), `size` is `Blob.size` in bytes. */
export async function saveWorkspaceCapture(page) {
  return await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const OrigCreateObjectURL = URL.createObjectURL.bind(URL);
        const OrigClick = HTMLAnchorElement.prototype.click;
        const t0 = performance.now();
        URL.createObjectURL = (blob) => {
          const durationMs = performance.now() - t0;
          URL.createObjectURL = OrigCreateObjectURL;
          HTMLAnchorElement.prototype.click = OrigClick;
          blob
            .text()
            .then((text) => resolve({ durationMs, text, size: blob.size }))
            .catch(reject);
          return "blob:harness-suppressed";
        };
        HTMLAnchorElement.prototype.click = function click() {
          /* no-op: block the real download attempt in headless Chrome */
        };
        window.__qz.useApp
          .getState()
          .saveWorkspaceToFile()
          .catch(reject);
      }),
  );
}

/** Poll the app's own IndexedDB autosave store until it reports zero
 *  retained generations, or `timeoutMs` elapses (returns false in that
 *  case). `clearAutosave()` (frontend/src/lib/autosave.ts) is invoked by
 *  the "Clear autosaved workspace…" command as `void clearAutosave()` —
 *  fire-and-forget from the UI's point of view — so a caller that clicks
 *  the command and immediately navigates away (as the F4 reopen test does,
 *  to stop autosave-restore-on-startup from pre-populating the library
 *  before the controlled `.dwk` open) can otherwise race the real
 *  IndexedDB clear transaction. Confirming empty first closes that race. */
export async function waitForAutosaveCleared(page, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const remaining = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open("qz.autosave", 1);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("generations")) {
              db.close();
              resolve(0);
              return;
            }
            const tx = db.transaction("generations", "readonly");
            const countReq = tx.objectStore("generations").count();
            countReq.onsuccess = () => {
              db.close();
              resolve(countReq.result);
            };
            countReq.onerror = () => {
              db.close();
              resolve(-1);
            };
          };
          req.onerror = () => resolve(-1);
        }),
    );
    if (remaining === 0) return true;
    if (Date.now() - start > timeoutMs) return false;
    await sleep(30);
  }
}

/** Poll the app's own IndexedDB autosave store (`qz.autosave` /
 *  `generations`, see frontend/src/lib/autosaveBackend.ts) from OUTSIDE the
 *  app for a generation whose `at` timestamp is >= `sinceMs`, using a
 *  second, independent `indexedDB.open` connection — this reads the exact
 *  storage the app itself writes to via the public IndexedDB API, no
 *  monkeypatching of app internals. `sinceMs` and the returned `at` are
 *  both plain `Date.now()`-style epoch ms (Node's and the browser's, same
 *  machine, same OS clock — unlike `performance.now()` this is safe to mix
 *  across the process boundary). Returns the winning generation's `at`, or
 *  null if none appeared within `timeoutMs`. */
export async function waitForAutosaveGeneration(page, sinceMs, timeoutMs = 8000) {
  return await page.evaluate(
    ({ sinceMs, timeoutMs }) => {
      const start = performance.now();
      function openDb() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open("qz.autosave", 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      }
      function poll() {
        return new Promise((resolve) => {
          (async () => {
            while (performance.now() - start < timeoutMs) {
              try {
                const db = await openDb();
                const hit = await new Promise((res, rej) => {
                  if (!db.objectStoreNames.contains("generations")) {
                    res(null);
                    return;
                  }
                  const tx = db.transaction("generations", "readonly");
                  const req = tx.objectStore("generations").getAll();
                  req.onsuccess = () => {
                    const rows = req.result || [];
                    const winner = rows.filter((r) => r.at >= sinceMs).sort((a, b) => a.at - b.at)[0];
                    res(winner ? winner.at : null);
                  };
                  req.onerror = () => rej(req.error);
                });
                db.close();
                if (hit != null) {
                  resolve(hit);
                  return;
                }
              } catch {
                /* transient — IndexedDB can be briefly busy between the
                   app's own read/write transactions; just retry. */
              }
              await new Promise((r) => setTimeout(r, 20));
            }
            resolve(null);
          })();
        });
      }
      return poll();
    },
    { sinceMs, timeoutMs },
  );
}
