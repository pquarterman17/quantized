// Figure Page save/dirty lifecycle — extracted out of useFigurePage.ts
// (FIGURE_AUTHORING_WORKFLOW_PLAN F3.4 size discipline: the hook had grown to
// 736 lines, flagged but not acted on by F3.3's log). Owns the persistable
// PageDocument projection, the F3.3 unresolved-slot Save gate, dirty-state
// predicates, Save/Save As/close-confirm, and the reopen (`pageDocSeed`)
// effect — everything that reads/writes the store's `pages` collection.
// useFigurePage.ts keeps ownership of `slots`/`draft` themselves (SlotGrid and
// the new F3.4 panel-editing actions mutate them directly); this hook is
// handed those setters and drives the save/reopen side of the session instead
// of owning the grid state itself.
import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";

import {
  pageDocumentDirty,
  pageDocumentHasUnsavedEdits,
  type PageDocument,
  type PagePanel,
} from "../../../lib/pageDocument";
import { slotLabels, type PageSlot } from "../../../lib/figurepage";
import { useApp } from "../../../store/useApp";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { toast } from "../../../store/toasts";
import { resolveSlotFigureId } from "./panelResolve";

export interface PageLifecycle {
  /** Per-slot previewed labels (auto sequence in row-major order, overrides
   *  win) — computed here (needs `draft.output.labelFormat` + `slots`) and
   *  forwarded, so useFigurePage doesn't recompute the same thing twice. */
  labels: string[];
  /** The full persistable draft (F3.1): `draft`'s geometry/output plus each
   *  slot's session source resolved to a canonical FigureDocument id where
   *  possible. This is what Save writes into `pages`. */
  pageDocument: PageDocument;
  /** F3.3: FILLED slots that would be silently dropped (`figureId: null`) if
   *  saved right now, each with a specific, actionable reason. */
  unresolvedSlots: string[];
  /** Has this session ever been saved (its id names a real `pages` entry)? */
  everSaved: boolean;
  /** Broad dirty (never saved, OR a saved page has drifted) — drives the
   *  Save affordance's "•" cue. */
  dirty: boolean;
  /** Narrow (false for a page never saved at all) — gates close-confirm. */
  hasUnsavedEdits: boolean;
  /** Save (update-in-place once saved, insert on the first save). Refused
   *  with the unresolved-slot reasons rather than silently dropping a panel. */
  save: () => void;
  /** Save As: always a NEW named entry; rebinds this session's draft to it. */
  saveAs: () => Promise<void>;
  /** Gate the ToolWindow's close button. Returns whether to actually close. */
  requestClose: () => Promise<boolean>;
}

export function usePageLifecycle(
  draft: PageDocument,
  setDraft: Dispatch<SetStateAction<PageDocument>>,
  slots: PageSlot[],
  setSlots: Dispatch<SetStateAction<PageSlot[]>>,
  setSelected: Dispatch<SetStateAction<number | null>>,
): PageLifecycle {
  const plotWindows = useApp((s) => s.plotWindows);
  const editableFigures = useApp((s) => s.editableFigures);
  const pages = useApp((s) => s.pages);
  const pageDocSeed = useApp((s) => s.pageDocSeed);
  const clearPageDocSeed = useApp((s) => s.clearPageDocSeed);
  const setStatus = useApp((s) => s.setStatus);

  const labels = useMemo(
    () => slotLabels(slots, draft.output.labelFormat),
    [slots, draft.output.labelFormat],
  );

  const pageDocument = useMemo<PageDocument>(
    () => ({
      ...draft,
      panels: slots.map((slot): PagePanel => ({
        figureId: resolveSlotFigureId(slot.source, plotWindows, editableFigures),
        label: slot.label,
        title: slot.title,
      })),
    }),
    [draft, slots, plotWindows, editableFigures],
  );

  // F3.3: reopen a saved page. `store.openPageDocument` seeds `pageDocSeed`;
  // this effect consumes it ONCE — mirrors useFigureBuilder.ts's own
  // `figureDocSeed` effect exactly, including its "unconditionally overwrite
  // the current session" behavior (opening a different page while this one
  // is unsaved is treated the same as switching documents in the figure
  // builder, not a new confirm surface — the close-confirm gate below covers
  // discarding via the WINDOW's close button). A saved PageDocument panel
  // only ever holds a canonical figureId (F3.1/F3.2), so every occupied panel
  // hydrates to a "figure" source; a dangling figureId (its figure was since
  // deleted) still gets a slot — it keeps its place on the grid and surfaces
  // through sourceStatuses/SlotGrid as "missing", never silently dropped.
  useEffect(() => {
    if (!pageDocSeed) return;
    const figures = useApp.getState().editableFigures;
    setDraft(pageDocSeed);
    setSlots(
      pageDocSeed.panels.map((panel): PageSlot => ({
        source: panel.figureId
          ? {
              kind: "figure",
              id: panel.figureId,
              name: figures.find((f) => f.id === panel.figureId)?.name ?? "deleted figure",
            }
          : null,
        label: panel.label,
        title: panel.title,
      })),
    );
    setSelected(null);
    clearPageDocSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageDocSeed, clearPageDocSeed]);

  /** F3.3: FILLED slots that would be silently dropped (`figureId: null`) if
   *  saved right now — an open plot window never saved as an editable
   *  figure, or a legacy Publication figure (F1 never gave that kind a
   *  FigureDocument counterpart, so it can never resolve). A "figure" source
   *  is NEVER listed here even if its target was since deleted: it already
   *  carries a real id, so Save persists that reference as-is (F3.2 fail-
   *  closed) rather than needing to block. Each entry names its slot's
   *  PREVIEWED label (matching what the user sees on the grid) and a
   *  specific, actionable next step — reusing the existing save/promote
   *  mechanisms (F1.4's per-window Save, and "Editable" copy-conversion)
   *  rather than inventing a new one. */
  const unresolvedSlots = useMemo(() => {
    const out: string[] = [];
    slots.forEach((slot, i) => {
      if (!slot.source) return;
      if (resolveSlotFigureId(slot.source, plotWindows, editableFigures) !== null) return;
      const label = labels[i] || `#${i + 1}`;
      out.push(
        slot.source.kind === "window"
          ? `slot ${label}: "${slot.source.name}" is an open plot window not yet saved as an editable figure — save it (its title-bar Save button, or File > Save Editable Figure), then Save this page again`
          : `slot ${label}: "${slot.source.name}" is a Publication figure — create an editable copy first (its "Editable" button in the Library), then assign the copy to this slot`,
      );
    });
    return out;
  }, [slots, labels, plotWindows, editableFigures]);

  const everSaved = pages.some((p) => p.id === pageDocument.id);
  const dirty = pageDocumentDirty(pageDocument, pages);
  const hasUnsavedEdits = pageDocumentHasUnsavedEdits(pageDocument, pages);

  function save(): void {
    if (unresolvedSlots.length > 0) {
      const msg = `cannot save page: ${unresolvedSlots.join("; ")}`;
      setStatus(msg);
      toast(msg, "danger");
      return;
    }
    const id = useApp.getState().savePage(pageDocument);
    const saved = useApp.getState().pages.find((p) => p.id === id);
    if (saved) setDraft((prev) => ({ ...prev, id: saved.id, createdAt: saved.createdAt, modifiedAt: saved.modifiedAt }));
  }

  async function saveAs(): Promise<void> {
    if (unresolvedSlots.length > 0) {
      const msg = `cannot save page: ${unresolvedSlots.join("; ")}`;
      setStatus(msg);
      toast(msg, "danger");
      return;
    }
    const { askParams } = await import("../../overlays/ParamDialog");
    const params = await askParams("Save page as", [
      { key: "name", label: "Name", type: "text", default: draft.name || "Untitled page" },
    ]);
    if (!params) return;
    const id = useApp.getState().savePageAs(pageDocument, String(params.name));
    if (!id) return;
    const saved = useApp.getState().pages.find((p) => p.id === id);
    if (saved) {
      setDraft((prev) => ({
        ...prev,
        id: saved.id,
        name: saved.name,
        createdAt: saved.createdAt,
        modifiedAt: saved.modifiedAt,
      }));
    }
  }

  /** Gate the ToolWindow's close button: only a SAVED page's drift confirms
   *  (see `hasUnsavedEdits`'s doc) — a fresh, never-saved page discards
   *  plainly, same as the pre-F3.3 "this composition is temporary" behavior.
   *  Returns whether the caller should actually close. */
  async function requestClose(): Promise<boolean> {
    if (!hasUnsavedEdits) return true;
    return askConfirm(
      `Close "${draft.name || "Untitled page"}" without saving?`,
      "Changes to this saved page will be lost. Use Save first to keep them.",
      "Close without saving",
      true,
    );
  }

  return { labels, pageDocument, unresolvedSlots, everSaved, dirty, hasUnsavedEdits, save, saveAs, requestClose };
}
