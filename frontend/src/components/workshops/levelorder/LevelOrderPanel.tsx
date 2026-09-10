// JMP_GAP J1 (Group O-2b) — the categorical level REORDER UI. Lets a user
// drag (via Move up/down) a categorical column's DISPLAY order away from
// plain ascending-by-code, or sort it by display label, writing
// `DataStruct.level_order` (Group O-2a's model layer — `lib/categorical.ts`,
// read that file's header first). All the actual logic lives in
// `store/levelOrder.ts` (state + commit, including the fail-open
// re-derivation and the reset-deletes-rather-than-stores rule); this is the
// view, following `RecodePanel.tsx`'s chrome. Opened from the worksheet's
// column context menu (`WorksheetPane.tsx`, "Reorder levels…", categorical
// columns only).
//
// BUNDLE SPLIT (bundle-size ratchet — scripts/check-bundle-size.mjs, the
// store/packProjectPanel.ts precedent): WorksheetPane.tsx and AppOverlays.tsx
// only ever touch the TINY store/levelOrderPanel.ts (an open flag + the
// column identity), never store/levelOrder.ts — that heavy store (`lib/
// recode.ts`'s `resolveRecodeChannel`, the commit/permutation logic) is
// imported HERE, and only here, so it loads inside this already-lazy chunk
// instead of the eager entry bundle. The mount effect below is therefore
// the seeding step that used to happen in `openPanel` at the menu — it
// still runs through `openLevelOrder` (and so through `categoryLevels`),
// just one render later.

import { useEffect } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import { useLevelOrder } from "../../../store/levelOrder";
import { useLevelOrderPanel } from "../../../store/levelOrderPanel";
import { useApp } from "../../../store/useApp";
import LevelOrderTable from "./LevelOrderTable";

export default function LevelOrderPanel() {
  const panelOpen = useLevelOrderPanel((s) => s.open);
  const panelDatasetId = useLevelOrderPanel((s) => s.datasetId);
  const panelChannel = useLevelOrderPanel((s) => s.channel);
  const closePanel = useLevelOrderPanel((s) => s.closePanel);

  const open = useLevelOrder((s) => s.open);
  const datasetId = useLevelOrder((s) => s.datasetId);
  const channel = useLevelOrder((s) => s.channel);
  const draft = useLevelOrder((s) => s.draft);
  const sortByLabel = useLevelOrder((s) => s.sortByLabel);
  const resetToCodeOrder = useLevelOrder((s) => s.resetToCodeOrder);
  const commit = useLevelOrder((s) => s.commit);
  const closeLevelOrder = useLevelOrder((s) => s.closeLevelOrder);
  const ds = useApp((s) => (datasetId != null ? s.datasets.find((d) => d.id === datasetId) : undefined));

  // Seed the heavy store from the tiny store's identity every time either
  // changes (i.e. on mount, and again if the menu is used to retarget while
  // this panel is somehow already mounted). `openLevelOrder` re-runs its OWN
  // `isCategoricalChannel` refusal (belt-and-braces for any caller other
  // than WorksheetPane's already-guarded menu entry) — if it refuses, it
  // toasts and leaves the heavy store closed, so close the tiny flag too
  // rather than leave AppOverlays holding this panel mounted with nothing
  // able to close it.
  useEffect(() => {
    if (panelDatasetId == null || panelChannel == null) return;
    useLevelOrder.getState().openLevelOrder(panelDatasetId, panelChannel);
    if (!useLevelOrder.getState().open) closePanel();
  }, [panelDatasetId, panelChannel, closePanel]);

  const closeBoth = () => {
    closeLevelOrder();
    closePanel();
  };

  if (!panelOpen || !open || !ds || channel == null) return null;

  return (
    <ToolWindow id="level-order-workshop" title={`Reorder levels — ${ds.data.labels[channel]}`} width={380} onClose={closeBoth}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {draft.length} level{draft.length === 1 ? "" : "s"}. Move up/down to set the display order used everywhere this
        column is grouped, faceted, or axis-labeled — the underlying codes never change.
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8 }}>
        <LevelOrderTable data={ds.data} channel={channel} draft={draft} />
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, justifyContent: "space-between" }}>
        <span style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={() => sortByLabel()}>
            Sort by label
          </Button>
          <Button size="sm" onClick={() => resetToCodeOrder()}>
            Reset to code order
          </Button>
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={closeBoth}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => { if (commit()) closePanel(); }}>
            Commit
          </Button>
        </span>
      </div>
    </ToolWindow>
  );
}
