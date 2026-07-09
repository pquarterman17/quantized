// Smart folders (project-organization plan item 9) — saved tag/name/format
// queries rendered as cross-cutting Library sections layered over the folder
// tree. Membership is derived per render (lib/smartfolders.smartFolderMembers)
// so a dataset can appear in several smart folders AND in its containment
// folder — these are saved searches, deliberately secondary to the tree.
// Hidden until the first smart folder exists (create one from the Library
// filter's ☆ button, or ＋ here afterwards).

import { useState } from "react";

import DatasetRow from "./DatasetRow";
import { smartFolderMembers } from "../../lib/smartfolders";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

interface Props {
  /** Click a tag chip inside a member row to filter the library to it. */
  onFilterTag: (tag: string) => void;
}

const QUERY_HINT = "terms AND'ed; bare = name/tag, or tag:… name:… format:…";

/** Shared name+query prompt (create + edit). Returns null on cancel. */
async function promptSmartFolder(
  title: string,
  name: string,
  query: string,
): Promise<{ name: string; query: string } | null> {
  const p = await askParams(title, [
    { key: "name", label: "Name", type: "text", default: name },
    { key: "query", label: "Query", type: "text", default: query, hint: QUERY_HINT },
  ]);
  if (!p || !String(p.name).trim()) return null;
  return { name: String(p.name), query: String(p.query) };
}

export default function SmartFoldersSection({ onFilterTag }: Props) {
  const smartFolders = useApp((s) => s.smartFolders);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const selectedIds = useApp((s) => s.selectedIds);
  const addSmartFolder = useApp((s) => s.addSmartFolder);
  const updateSmartFolder = useApp((s) => s.updateSmartFolder);
  const removeSmartFolder = useApp((s) => s.removeSmartFolder);
  // Collapsed by default — a broad query can match much of the library, and
  // the count chip already answers "how many" at a glance.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());

  if (smartFolders.length === 0) return null;

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="qzk-lib-group">
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <span className="qzk-lib-title" style={{ flex: 1, padding: "4px 6px" }}>
          Smart folders
        </span>
        <button
          className="qz-btn qz-ghost qz-sm"
          title="New smart folder…"
          onClick={() => {
            void promptSmartFolder("New smart folder", "", "").then((r) => {
              if (r) addSmartFolder(r.name, r.query);
            });
          }}
        >
          ＋
        </button>
      </div>
      {smartFolders.map((sf) => {
        const members = smartFolderMembers(datasets, sf);
        const open = openIds.has(sf.id);
        return (
          <div key={sf.id}>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <button
                className="qzk-group-head"
                style={{ flex: 1 }}
                title={sf.query ? `query: ${sf.query}` : "empty query — matches everything"}
                onClick={() => toggle(sf.id)}
              >
                <span className="qzk-group-caret">{open ? "▾" : "▸"}</span>
                <span className="qzk-group-name">☆ {sf.name}</span>
                <span className="qzk-group-count">{members.length}</span>
              </button>
              <button
                className="qz-btn qz-ghost qz-sm"
                title="Edit smart folder…"
                onClick={() => {
                  void promptSmartFolder("Edit smart folder", sf.name, sf.query).then((r) => {
                    if (r) updateSmartFolder(sf.id, r.name, r.query);
                  });
                }}
              >
                ✎
              </button>
              <button
                className="qz-btn qz-ghost qz-sm"
                title="Delete smart folder (datasets are untouched)"
                onClick={() => removeSmartFolder(sf.id)}
              >
                ×
              </button>
            </div>
            {open &&
              members.map((d) => (
                <DatasetRow
                  key={d.id}
                  dataset={d}
                  active={d.id === activeId}
                  selected={selectedIds.includes(d.id)}
                  showReorder={false}
                  canMoveUp={false}
                  canMoveDown={false}
                  onFilterTag={onFilterTag}
                  depth={1}
                />
              ))}
            {open && members.length === 0 && (
              <div className="qzk-ds-meta" style={{ padding: "2px 20px" }}>
                no matches
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
