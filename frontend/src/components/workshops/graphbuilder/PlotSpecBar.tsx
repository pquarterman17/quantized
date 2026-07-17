// The Graph Builder's saved-PlotSpec toolbar (GUI_INTERACTION_PLAN #11 —
// "durable artifact"): the active spec's name + unsaved-changes dot, Save /
// Save As, and a collapsible "Saved graphs" list with per-row Open/Duplicate/
// Rename/Delete. Sits ABOVE the wells in GraphBuilderPanel and stays visible
// even with no dataset selected, so a user can still manage saved graphs.
//
// Owns the two dialogs (name prompt, delete confirm) — mirrors FolderRow.tsx/
// PlotContextMenu.tsx's "the component calls askParams/askConfirm directly"
// convention — so useGraphBuilder.ts stays a pure state hook with no overlay
// coupling. All mutation still routes through the hook's wrapper functions
// (which route through the store); this component only decides WHEN to ask.

import type { SavedPlotSpec } from "../../../lib/plotspec";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { askParams } from "../../overlays/ParamDialog";
import { Button, Card, IconButton, StatusDot } from "../../primitives";

export interface PlotSpecBarProps {
  specs: SavedPlotSpec[];
  activeSpec: SavedPlotSpec | null;
  dirty: boolean;
  /** Gates Save/Save As — nothing worth saving yet (mirrors `canSend`). */
  canSave: boolean;
  onSaveActive: () => void;
  onSaveAs: (name: string) => void;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

async function promptName(title: string, initial: string): Promise<string | null> {
  const params = await askParams(title, [{ key: "name", label: "Name", type: "text", default: initial }]);
  if (!params) return null;
  return String(params.name);
}

export default function PlotSpecBar({
  specs,
  activeSpec,
  dirty,
  canSave,
  onSaveActive,
  onSaveAs,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
}: PlotSpecBarProps) {
  async function handleSave(): Promise<void> {
    if (activeSpec) {
      onSaveActive();
      return;
    }
    const name = await promptName("Save graph as", "Untitled graph");
    if (name !== null) onSaveAs(name);
  }

  async function handleSaveAs(): Promise<void> {
    const name = await promptName("Save graph as", activeSpec?.name ?? "Untitled graph");
    if (name !== null) onSaveAs(name);
  }

  async function handleRename(p: SavedPlotSpec): Promise<void> {
    const name = await promptName("Rename graph", p.name);
    if (name !== null) onRename(p.id, name);
  }

  async function handleDelete(p: SavedPlotSpec): Promise<void> {
    const ok = await askConfirm(
      "Delete saved graph?",
      `"${p.name}" will be removed. This can't be undone.`,
      "Delete",
      true,
    );
    if (ok) onDelete(p.id);
  }

  const sorted = [...specs].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  return (
    <div className="qzk-plotspec-bar">
      <div className="qzk-plotspec-bar-row">
        <span className="qzk-plotspec-name" title={activeSpec ? activeSpec.name : "Not saved yet"}>
          {activeSpec ? activeSpec.name : "Unsaved graph"}
          {dirty && <StatusDot tone="accent" label="modified" />}
        </span>
        <Button size="sm" disabled={!canSave} onClick={() => void handleSave()}>
          Save
        </Button>
        <Button size="sm" disabled={!canSave} onClick={() => void handleSaveAs()}>
          Save As…
        </Button>
      </div>

      <Card title="Saved graphs" count={specs.length || undefined} defaultOpen={false}>
        {sorted.length === 0 ? (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            No saved graphs yet — build one below, then Save.
          </div>
        ) : (
          sorted.map((p) => (
            <div key={p.id} className={`qz-meta-row qzk-plotspec-row${p.id === activeSpec?.id ? " active" : ""}`}>
              <button
                type="button"
                className="qzk-plotspec-open"
                onClick={() => onOpen(p.id)}
                title={`Open "${p.name}"`}
              >
                {p.name}
              </button>
              <span className="qzk-plotspec-actions">
                <IconButton title="Duplicate" aria-label={`Duplicate ${p.name}`} onClick={() => onDuplicate(p.id)}>
                  ⧉
                </IconButton>
                <IconButton title="Rename" aria-label={`Rename ${p.name}`} onClick={() => void handleRename(p)}>
                  ✎
                </IconButton>
                <IconButton title="Delete" aria-label={`Delete ${p.name}`} onClick={() => void handleDelete(p)}>
                  ✕
                </IconButton>
              </span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
