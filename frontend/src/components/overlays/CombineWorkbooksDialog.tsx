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
// open (`resolveCombineTargets`, called inside the re-seed effect against a
// non-reactive `useApp.getState().datasets` snapshot — NOT the reactive
// `datasets` subscription, which would re-run the resolve on every
// unrelated store change and silently re-widen a workbook-scoped seed as
// datasets are added elsewhere while the dialog sits open, adversarial-
// review P1, 2026-08-19) — the dialog only lets the user NARROW that FROZEN
// list (uncheck an item), never widen it to arbitrary other Library items
// the invoking gesture never named. That keeps this dialog a genuine
// "confirm" step, not a second full Library picker. Committing reads ONLY
// this frozen `resolvedIds` (via `includedIds`) — never re-resolves the
// seed — so the freeze can't be undone one layer down at commit time. The
// mirror case (a frozen id whose dataset was DELETED while the dialog sat
// open) is handled at commit: dead ids are dropped, the survivors combine
// with an honest "skipped N" notice, and a fully-dead selection refuses
// outright with an inline message instead of silently doing nothing.
//
// Collision suffixing is shown, not just applied (L0.34's "never overwrite
// silently" — visible, not just true): the live preview below the checklist
// renders the ACTUAL `dedupeWorksheetNames` output for the currently-checked
// items, so a "Name" / "Name (2)" collision is something the user sees
// before confirming, not something that happens invisibly on commit.

import { useEffect, useState } from "react";

import { dedupeWorksheetNames, resolveCombineTargets, suggestCombinedWorkbookName } from "../../lib/workbookCombine";
import { Button } from "../primitives";
import { toast } from "../../store/toasts";
import { useCombineDialog } from "../../store/combineDialog";
import { useApp } from "../../store/useApp";

export default function CombineWorkbooksDialog() {
  const seed = useCombineDialog((s) => s.seed);
  const close = useCombineDialog((s) => s.close);
  const datasets = useApp((s) => s.datasets);
  const workbooks = useApp((s) => s.workbooks);
  const combineWorkbooks = useApp((s) => s.combineWorkbooks);

  // Adversarial-review P1 fix (2026-08-19): FROZEN at open, not re-derived
  // from live `datasets` on every render — the bug this closes is a
  // workbook-scoped seed silently re-widening as datasets change under an
  // open dialog (a background import landing in the seeded workbook used to
  // appear pre-checked and get combined without ever being shown to the
  // user). `resolveCombineTargets` is called exactly ONCE per open, inside
  // this SAME re-seed effect, against `useApp.getState().datasets` (a
  // non-reactive snapshot at the moment of open — deliberately NOT the
  // reactive `datasets` above, which would defeat the freeze the instant it
  // changed). Committing below reads ONLY this frozen list (via
  // `includedIds`), never re-resolves the seed, so the freeze can't be
  // silently undone one layer down.
  const [resolvedIds, setResolvedIds] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Re-seed every time the dialog opens for a (possibly different) seed
  // selection — never carry a stale checklist/name from the last time it was
  // open (SplitDatasetDialog's identical re-seed-on-open discipline).
  useEffect(() => {
    setResolvedIds(seed ? resolveCombineTargets(seed, useApp.getState().datasets) : []);
    setExcluded(new Set());
    setName("");
    setNameDirty(false);
    setCommitError(null);
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

  // Mirror case the freeze introduces (adversarial-review P1): a frozen id
  // whose dataset was deleted (by some other gesture) while the dialog sat
  // open. Never silently resurrect it or crash — drop it here, at the LAST
  // possible moment before commit, and either combine the survivors with an
  // honest notice of what was skipped, or refuse outright (fail-closed,
  // matching SeparateWorksheetsDialog's own voice) when nothing survives.
  const runCombine = (): void => {
    if (!canCombine) return;
    const live = new Set(useApp.getState().datasets.map((d) => d.id));
    const liveIds = includedIds.filter((id) => live.has(id));
    const droppedCount = includedIds.length - liveIds.length;
    if (liveIds.length === 0) {
      setCommitError("Combine unavailable: every selected worksheet no longer exists — re-open Combine to refresh the selection");
      return;
    }
    const newId = combineWorkbooks({ workbookIds: [], worksheetIds: liveIds }, name);
    if (!newId) return;
    if (droppedCount > 0) {
      toast(`combined ${liveIds.length} worksheet(s) — skipped ${droppedCount} that no longer exist`, "ok");
    }
    close();
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
        {commitError && (
          <div className="qzk-ds-meta" style={{ color: "var(--danger, #d33)", marginTop: 8 }}>
            {commitError}
          </div>
        )}
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
