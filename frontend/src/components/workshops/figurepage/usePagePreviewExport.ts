// Figure Page composer: the ONE spec-derivation path (`buildSpec`) plus its
// three consumers — the debounced low-DPI preview, file export, and (F3.6)
// clipboard copy. Extracted out of useFigurePage.ts (FIGURE_AUTHORING_
// WORKFLOW_PLAN F3.6 size discipline: the hook was already at 483/500,
// flagged by F3.5's log as the closest it had been to the habit ceiling —
// mirrors the F3.4 precedent of extracting a cohesive slice rather than
// letting the file re-grow past it).
//
// `buildSpec` is deliberately the ONLY place that turns `slots` into a
// `FigurePageSpec` (sans fmt/dpi — each consumer below picks its own): the
// preview effect, `exportNow`, and the new `copyNow` all call it, so there is
// exactly one panel-resolution path for "preview vs file export vs clipboard
// copy" to ever drift apart on — see panelResolve.ts's module header for the
// window-panel fidelity fix (F3.6) that this unification actually surfaced.
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { exportFigurePage, renderFigurePageBlob, type FigurePageSpec, type PagePanelSpec } from "../../../lib/api";
import { clipboardImageSupported, copyImageAsync } from "../../../lib/clipboard";
import { filledCount, type PageLabelFormat, type PageLabelPosition, type PageSlot } from "../../../lib/figurepage";
import type { PageLayoutSettings } from "../../../lib/pageDocument";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { panelFigure, panelRenderInputs } from "./panelResolve";

const PREVIEW_DPI = 90; // screen-resolution page preview; export/copy use the chosen DPI
/** A7 "Office clipboard" convention: 300 DPI is the same publication floor
 *  the single-figure "Copy figure" command uses (copyFigureCommand.ts's
 *  COPY_FIGURE_DPI) — a copied page matches a copied single figure. */
export const COPY_PAGE_DPI = 300;

/** Blob -> data: URL (FileReader, jsdom-safe — no URL.createObjectURL). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("preview read failed"));
    r.readAsDataURL(blob);
  });
}

/** The page-level fields `buildSpec` needs beyond `slots` — exactly the
 *  session draft's geometry/output/layout, threaded in rather than read from
 *  a shared draft object so this hook stays decoupled from useFigurePage's
 *  own state shape. */
export interface PagePreviewExportOutput {
  rows: number;
  cols: number;
  style: string;
  labelFormat: PageLabelFormat;
  labelPos: PageLabelPosition;
  layout: PageLayoutSettings;
  fmt: string;
  dpi: number;
}

export function usePagePreviewExport(slots: PageSlot[], output: PagePreviewExportOutput) {
  const setStatus = useApp((s) => s.setStatus);
  const { rows, cols, style, labelFormat, labelPos, layout, fmt, dpi } = output;

  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // #8g: the store state the assigned panels render from (see
  // panelRenderInputs) — useShallow keeps the reference stable until one of
  // those inputs actually changes, so it can key the preview effect below.
  const renderInputs = useApp(useShallow((s) => panelRenderInputs(slots, s)));

  /** The page spec (sans format/dpi — each consumer below chooses its own).
   *  null when nothing is assigned or nothing can render anymore. The ONE
   *  spec-derivation path (F3.6) — see the module header. */
  async function buildSpec(): Promise<FigurePageSpec | null> {
    if (filledCount(slots) === 0) return null;
    const panels: PagePanelSpec[] = [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.source) continue;
      const figure = await panelFigure(slot.source);
      if (!figure) {
        // A dead source (window closed, dataset gone) must FAIL the build,
        // not silently drop the panel and re-letter the rest (review
        // 2026-07-11: export no longer matched the last-rendered preview).
        setError(`slot ${i + 1}: source "${slot.source.name}" no longer exists - clear or reassign it`);
        return null;
      }
      panels.push({
        figure,
        row: Math.floor(i / cols),
        col: i % cols,
        ...(slot.label !== null ? { label: slot.label } : {}),
        ...(slot.title !== null ? { title: slot.title } : {}),
      });
    }
    if (panels.length === 0) return null;
    return {
      rows,
      cols,
      panels,
      style,
      label_format: labelFormat,
      label_pos: labelPos,
      row_gap: layout.rowGap,
      col_gap: layout.colGap,
      link_x: layout.linkX,
      link_y: layout.linkY,
      align_labels: layout.alignLabels,
      resize_mode: layout.resizeMode,
    };
  }

  // Debounced low-DPI PNG preview — re-renders on any page-shape change AND
  // when the store state an assigned panel renders from changes underneath
  // it (#8g — renderInputs), so the preview never goes silently stale.
  useEffect(() => {
    let cancelled = false;
    if (filledCount(slots) === 0) {
      setPreview(null);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const spec = await buildSpec();
          if (cancelled) return;
          if (!spec) {
            // F3.2: past the filledCount===0 guard above, buildSpec() can
            // only return null because it hit a dead source and already
            // called setError() with the specific "slot N: ... no longer
            // exists" message — do NOT clear it here. This branch used to
            // unconditionally setError(null) right after buildSpec set it,
            // so a missing panel silently fell back to the plain "assign
            // plots to grid slots" empty-state text with no explanation
            // (exactly the "render a hole without explanation" failure mode
            // F3.2 rules out). Only clear preview; leave the message intact.
            setPreview(null);
            return;
          }
          const blob = await renderFigurePageBlob({ ...spec, fmt: "png", dpi: PREVIEW_DPI });
          const url = await blobToDataUrl(blob);
          if (!cancelled) {
            setPreview(url);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "preview failed");
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // buildSpec reads slots/rows/cols/style/labels/layout from local state
    // plus the panels' windows/datasets/docs THROUGH the store — renderInputs
    // is the fingerprint of exactly those store reads (#8g); the 400 ms
    // debounce absorbs any churn while they settle. F3.5: `layout` joins the
    // dep list so a gap/link/align/resize-mode change refreshes the preview
    // the same way a style/label change already does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, rows, cols, style, labelFormat, labelPos, layout, renderInputs]);

  async function exportNow(): Promise<void> {
    try {
      // F3.2: distinguish "nothing assigned" from "something is assigned but
      // can't render" BEFORE calling buildSpec — it used to report the same
      // "assign at least one panel" message for both, which is actively
      // misleading when panels ARE assigned and one has simply gone missing
      // (window closed / figure deleted since it was dropped onto the grid).
      if (filledCount(slots) === 0) {
        setStatus("assign at least one panel to export a figure page");
        return;
      }
      const spec = await buildSpec();
      if (!spec) {
        // buildSpec() already set the specific `error` state (visible in the
        // preview pane); mirror it on the status bar too so Export's failure
        // reads the same as the preview's, not a generic non-sequitur.
        setStatus("cannot export: a panel's source is missing - see the highlighted slot, then clear or reassign it");
        return;
      }
      await exportFigurePage({ ...spec, fmt, dpi });
      setStatus(`exported figure_page.${fmt}`);
    } catch (e) {
      setStatus(`export failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  /** F3.6 "clipboard copy for pages" (A7 convention): 300-DPI PNG straight to
   *  the Office clipboard, through the SAME `buildSpec` preview/export share
   *  — never a third ad-hoc render path. Mirrors copyFigureCommand.ts's
   *  gesture-preserving pattern: check capability BEFORE any async work (a
   *  render on a browser that can't accept it would be pure waste), then
   *  hand the PENDING render to `copyImageAsync` rather than awaiting it
   *  first, so the write stays inside the originating click. */
  async function copyNow(): Promise<void> {
    if (!clipboardImageSupported()) {
      const msg = "clipboard image unavailable - use Export";
      setStatus(msg);
      toast(msg, "danger");
      return;
    }
    if (filledCount(slots) === 0) {
      setStatus("assign at least one panel to copy a figure page");
      return;
    }
    const spec = await buildSpec();
    if (!spec) {
      setStatus("cannot copy: a panel's source is missing - see the highlighted slot, then clear or reassign it");
      return;
    }
    setStatus("rendering figure page for the clipboard…");
    const ok = await copyImageAsync(renderFigurePageBlob({ ...spec, fmt: "png", dpi: COPY_PAGE_DPI }));
    setStatus(ok ? "figure page copied to clipboard" : "");
    if (!ok) toast("clipboard write refused", "danger");
  }

  return { preview, error, busy, buildSpec, exportNow, copyNow };
}
