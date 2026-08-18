// Relink Sources panel (P1.7 box 3: relink-one and relink-folder with a
// dry-run preview). One unified flow covers both: pick exactly the ONE
// dataset whose source moved for "relink-one" (its own path as the old
// root), or a whole moved directory for "relink-folder" — the store logic
// (`store/relink.ts`) doesn't distinguish the two, only how many datasets
// happen to fall under the chosen old root. See that module's doc for the
// dry-run/commit/undo/consent mechanics; this file is the view only.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, DataTable } from "../../primitives";
import { useRelink, relinkableDatasets, type RelinkRowStatus } from "../../../store/relink";

const STATUS_LABEL: Record<RelinkRowStatus, string> = {
  resolved: "resolved",
  missing: "missing",
  offline: "offline (volume unreachable)",
  permission_denied: "permission denied",
  no_candidate: "not under old root",
  unavailable: "source checks unavailable (no desktop bridge)",
};

const STATUS_COLOR: Record<RelinkRowStatus, string> = {
  resolved: "var(--ok, var(--accent))",
  missing: "var(--danger, var(--warn))",
  offline: "var(--warn, var(--text-faint))",
  permission_denied: "var(--danger, var(--warn))",
  no_candidate: "var(--text-faint)",
  unavailable: "var(--text-faint)",
};

export default function RelinkPanel() {
  const open = useRelink((s) => s.open);
  const oldRoot = useRelink((s) => s.oldRoot);
  const newRoot = useRelink((s) => s.newRoot);
  const preview = useRelink((s) => s.preview);
  const busy = useRelink((s) => s.busy);
  const bridgeAvailable = useRelink((s) => s.bridgeAvailable);
  const setOldRoot = useRelink((s) => s.setOldRoot);
  const setNewRoot = useRelink((s) => s.setNewRoot);
  const runPreview = useRelink((s) => s.runPreview);
  const commit = useRelink((s) => s.commit);
  const closePanel = useRelink((s) => s.closePanel);
  const importChangedAsNewVersion = useRelink((s) => s.importChangedAsNewVersion);

  if (!open) return null;

  const candidateCount = relinkableDatasets().length;
  const committable = preview.filter(
    (r) => r.status === "resolved" && r.changeVerdict !== "changed",
  ).length;
  const changedCount = preview.filter((r) => r.changeVerdict === "changed").length;

  return (
    <ToolWindow id="relink-sources" title="Relink sources" width={560} onClose={closePanel}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {candidateCount === 0
          ? "no datasets in this project have a recorded source path"
          : `${candidateCount} dataset${candidateCount === 1 ? "" : "s"} carry a source. Point one file's ` +
            `old folder at its new location — for a single moved file, use its own containing folder as the old root.`}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        <label className="qzk-field-lbl" htmlFor="relink-old-root">
          Old folder (as recorded)
        </label>
        <input
          id="relink-old-root"
          className="qz-input"
          value={oldRoot}
          onChange={(e) => setOldRoot(e.target.value)}
          placeholder="/old/path/to/data"
        />
        <label className="qzk-field-lbl" htmlFor="relink-new-root">
          New folder (where it moved)
        </label>
        <input
          id="relink-new-root"
          className="qz-input"
          value={newRoot}
          onChange={(e) => setNewRoot(e.target.value)}
          placeholder="/new/path/to/data"
        />
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <Button size="sm" onClick={() => void runPreview()} disabled={busy}>
          {busy ? "checking…" : "Preview"}
        </Button>
        <Button size="sm" onClick={commit} disabled={committable === 0}>
          Relink {committable > 0 ? committable : ""}
        </Button>
      </div>

      {!bridgeAvailable && preview.length > 0 && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          no desktop bridge in this session — source reachability can't be checked here; reopen from
          the desktop app to relink.
        </div>
      )}

      {preview.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 320, overflowY: "auto" }}>
          <DataTable
            columns={["dataset", "candidate", "status", ""]}
            rows={preview.map((row) => [
              row.datasetName,
              <span key="c" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }} title={row.candidatePath ?? ""}>
                {row.candidatePath ?? "—"}
              </span>,
              <span key="s" style={{ color: STATUS_COLOR[row.status] }}>
                {STATUS_LABEL[row.status]}
                {row.changeVerdict === "changed" ? " — content changed" : ""}
              </span>,
              row.changeVerdict === "changed" ? (
                <Button key="v" size="sm" onClick={() => void importChangedAsNewVersion(row.datasetId)}>
                  Import as new version
                </Button>
              ) : (
                ""
              ),
            ])}
          />
        </div>
      )}

      {changedCount > 0 && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, var(--text-faint))" }}>
          {changedCount} source{changedCount === 1 ? "" : "s"} changed content since import — excluded
          from Relink. Import as a new version instead; the original is left untouched.
        </div>
      )}
    </ToolWindow>
  );
}
