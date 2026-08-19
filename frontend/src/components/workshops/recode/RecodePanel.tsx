// J2 Recode workshop (JMP_GAP_PLAN item 2) — merge/rename/bin levels of a
// categorical column with a live preview, producing a DERIVED column (raw
// stays immutable), one undo entry, provenance recorded, plus plain
// find-replace over the level text and a saveable/re-applicable mapping.
// All the actual logic lives in store/recode.ts (state + commit) and
// lib/recode.ts (pure mapping math) — this is the view + a bit of local
// UI-only state (the find/replace/save-name text fields, which don't need
// to survive a close/reopen). Opened from the worksheet's column context
// menu (WorksheetPane.tsx, "Recode…", categorical columns only).

import { useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import { activeRecodePreview, useRecode } from "../../../store/recode";
import { useApp } from "../../../store/useApp";
import RecodeMappingTable from "./RecodeMappingTable";

export default function RecodePanel() {
  const open = useRecode((s) => s.open);
  const datasetId = useRecode((s) => s.datasetId);
  const channel = useRecode((s) => s.channel);
  const mapping = useRecode((s) => s.mapping); // subscribed so a preview recompute below is reactive
  const newColumnName = useRecode((s) => s.newColumnName);
  const savedMappings = useRecode((s) => s.savedMappings);
  const setNewColumnName = useRecode((s) => s.setNewColumnName);
  const applyFindReplace = useRecode((s) => s.applyFindReplace);
  const commitRecode = useRecode((s) => s.commitRecode);
  const saveMapping = useRecode((s) => s.saveMapping);
  const deleteMapping = useRecode((s) => s.deleteMapping);
  const applySavedMapping = useRecode((s) => s.applySavedMapping);
  const closeRecode = useRecode((s) => s.closeRecode);
  const ds = useApp((s) => (datasetId != null ? s.datasets.find((d) => d.id === datasetId) : undefined));

  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [saveName, setSaveName] = useState("");

  if (!open || !ds || channel == null) return null;
  // `mapping` is read above only to force a re-render when it changes;
  // activeRecodePreview() recomputes it fresh against the live store here.
  void mapping;
  const preview = activeRecodePreview();
  if (!preview) return null; // the source stopped being categorical mid-session — nothing to show

  return (
    <ToolWindow id="recode-workshop" title={`Recode — ${ds.data.labels[channel]}`} width={560} onClose={closeRecode}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {preview.rows.length} level{preview.rows.length === 1 ? "" : "s"} → {preview.newLevels.length} after recode.
        Type a new label per row; typing the SAME label into two rows merges them.
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
        <input
          className="qz-input"
          style={{ flex: 1 }}
          placeholder="find"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <input
          className="qz-input"
          style={{ flex: 1 }}
          placeholder="replace with"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
        />
        <label className="qz-check" title="Case-sensitive match">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Aa
        </label>
        <Button size="sm" onClick={() => applyFindReplace(find, replace, caseSensitive)} disabled={!find}>
          Find/Replace
        </Button>
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto", marginTop: 10 }}>
        <RecodeMappingTable preview={preview} />
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
        <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>New column</span>
        <input
          className="qz-input"
          style={{ flex: 1 }}
          value={newColumnName}
          onChange={(e) => setNewColumnName(e.target.value)}
        />
        <Button size="sm" variant="primary" onClick={() => commitRecode()}>
          Commit
        </Button>
      </div>

      <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            className="qz-input"
            style={{ flex: 1 }}
            placeholder="save this mapping as…"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => {
              saveMapping(saveName);
              setSaveName("");
            }}
            disabled={!saveName.trim()}
          >
            Save mapping
          </Button>
        </div>
        {savedMappings.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {savedMappings.map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <span title={`built from: ${m.sourceLevels.join(", ")}`}>{m.name}</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <Button size="sm" onClick={() => applySavedMapping(m.id)}>
                    Apply
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => deleteMapping(m.id)} title="Delete this saved mapping">
                    ×
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolWindow>
  );
}
