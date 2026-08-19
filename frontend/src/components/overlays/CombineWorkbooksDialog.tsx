// Combine dialog UI (LIBRARY_WORKBOOK_UX_PLAN PR J slice 2 — L0.32-L0.34).
// The store contracts (`resolveCombineTargets`/`suggestCombinedWorkbookName`/
// `dedupeWorksheetNames`, `combineWorkbooks`) landed complete + independently
// tested in slice 1 (lib/workbookCombine.ts, store/workbookCombine.ts); this
// file is only the dialog around them — SplitDatasetDialog's modal-backdrop +
// live-preview convention, custom-bodied the same way for the same reason
// (no generic dialog fits a checklist + a live collision-suffix preview that
// recomputes on every toggle).
//
// "Choose/confirm the selection" (the plan's UI brief): the SEED
// (`store/combineDialog.ts`) is resolved to its flat worksheet list ONCE, on
// open (`resolveCombineTargets`) — the dialog only lets the user NARROW that
// list (uncheck an item), never widen it to arbitrary other Library items
// the invoking gesture never named. That keeps this dialog a genuine
// "confirm" step, not a second full Library picker.
//
// Collision suffixing is shown, not just applied (L0.34's "never overwrite
// silently" — visible, not just true): the live preview below the checklist
// renders the ACTUAL `dedupeWorksheetNames` output for the currently-checked
// items, so a "Name" / "Name (2)" collision is something the user sees
// before confirming, not something that happens invisibly on commit.

import { useEffect, useState } from "react";

import { dedupeWorksheetNames, resolveCombineTargets, suggestCombinedWorkbookName } from "../../lib/workbookCombine";
import { Button } from "../primitives";
import { useCombineDialog } from "../../store/combineDialog";
import { useApp } from "../../store/useApp";

export default function CombineWorkbooksDialog() {
  const seed = useCombineDialog((s) => s.seed);
  const close = useCombineDialog((s) => s.close);
  const datasets = useApp((s) => s.datasets);
  const workbooks = useApp((s) => s.workbooks);
  const combineWorkbooks = useApp((s) => s.combineWorkbooks);

  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);

  // Re-seed every time the dialog opens for a (possibly different) seed
  // selection — never carry a stale checklist/name from the last time it was
  // open (SplitDatasetDialog's identical re-seed-on-open discipline).
  useEffect(() => {
    setExcluded(new Set());
    setName("");
    setNameDirty(false);
  }, [seed]);

  useEffect(() => {
    if (!seed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [seed, close]);

  // Hooks run unconditionally (same discipline as SplitDatasetDialog) — the
  // "closed" case is handled by an empty resolved list, not by skipping a hook.
  const resolvedIds = seed ? resolveCombineTargets(seed, datasets) : [];
  const includedIds = resolvedIds.filter((id) => !excluded.has(id));
  const includedNames = includedIds.map((id) => datasets.find((d) => d.id === id)?.name ?? id);
  const dedupedNames = dedupeWorksheetNames(includedNames);
  const suggestion = suggestCombinedWorkbookName(includedNames);

  // Live-reseed the name from the suggestion as the checked set changes —
  // but only until the user actually types something themselves (the same
  // "seed once, then respect the user's edit" contract SplitDatasetDialog's
  // tolerance field uses).
  useEffect(() => {
    if (!nameDirty) setName(suggestion ?? "");
  }, [suggestion, nameDirty]);

  if (!seed) return null;

  const canCombine = includedIds.length >= 1 && name.trim() !== "";

  const runCombine = (): void => {
    if (!canCombine) return;
    const newId = combineWorkbooks({ workbookIds: [], worksheetIds: includedIds }, name);
    if (newId) close();
  };

  const toggle = (id: string): void =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canCombine) runCombine();
          e.stopPropagation();
        }}
      >
        <h2>Combine into new workbook</h2>
        <div className="qz-ws-row">
          <span className="k">Name</span>
          <input
            className="qz-input"
            aria-label="Workbook name"
            value={name}
            onChange={(e) => {
              setNameDirty(true);
              setName(e.target.value);
            }}
          />
        </div>
        <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 8, display: "grid", gap: 4 }}>
          {resolvedIds.map((id) => {
            const d = datasets.find((x) => x.id === id);
            const source = d?.workbookId ? workbooks.find((w) => w.id === d.workbookId)?.name : undefined;
            return (
              <label key={id} className="qzk-combine-item" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={!excluded.has(id)} onChange={() => toggle(id)} aria-label={d?.name ?? id} />
                <span>{d?.name ?? id}</span>
                {source && <span className="qzk-ds-meta">— {source}</span>}
              </label>
            );
          })}
        </div>
        <div className="qzk-ds-meta" style={{ marginTop: 8 }}>
          Worksheet names in the new workbook:
        </div>
        <div className="qzk-combine-preview" style={{ display: "grid", gap: 2 }}>
          {dedupedNames.length === 0 ? (
            <span className="qzk-ds-meta">nothing selected</span>
          ) : (
            dedupedNames.map((n, i) => <span key={`${n}-${i}`}>{n}</span>)
          )}
        </div>
        <div className="qz-btn-row">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!canCombine} onClick={runCombine}>
            Combine
          </Button>
        </div>
      </div>
    </div>
  );
}
