// Collections (LIBRARY_WORKBOOK_UX_PLAN PR L, L0.48/L0.49) — saved-search
// virtual views, rendered as a cross-cutting Library section: the same shape
// as SmartFoldersSection, generalized to the canonical Library hierarchy
// (lib/collections.ts's `collectionMembers`) instead of a flat dataset list,
// so a workbook — or any other node kind — can appear in any number of
// Collections while it keeps exactly ONE real folder location. Clicking a
// member reveals that real location (L0.48's ownership distinction stays
// visible) instead of opening a second, fake place for it to "live". Hidden
// until the first Collection exists (save one from the Library filter's ⊙
// button, or ＋ here afterwards).

import { useRef, useState } from "react";

import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import { collectionMembers } from "../../lib/collections";
import type { LibraryHierarchy, LibraryNode, LibraryNodeKind } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

interface Props {
  hierarchy: LibraryHierarchy;
  /** L0.48's "Show in Library": clears search and reveals the member's ONE
   *  real location in the tree — never a second, Collection-owned place. */
  onShowInLibrary: (node: LibraryNode) => void;
}

const QUERY_HINT = "terms AND'ed; bare = name/tag, or tag:… name:… format:…";
const KIND_GLYPH: Record<LibraryNodeKind, string> = {
  folder: "▦", workbook: "▤", worksheet: "·", "origin-figure": "▥",
  "editable-figure": "▥", "publication-figure": "▥", page: "▥", report: "▥",
};

export default function CollectionsSection({ hierarchy, onShowInLibrary }: Props) {
  const collections = useApp((s) => s.collections);
  const addCollection = useApp((s) => s.addCollection);
  const renameCollection = useApp((s) => s.renameCollection);
  const updateCollectionQuery = useApp((s) => s.updateCollectionQuery);
  const removeCollection = useApp((s) => s.removeCollection);
  // Collapsed by default — same rationale as SmartFoldersSection: the count
  // chip already answers "how many" without expanding every Collection.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  // Retrospective-audit P1 fix pattern (SmartFoldersSection): the × button
  // unmounts its own row on click — the focusGuard pair keeps a stray
  // Delete/Backspace from then hitting the active dataset.
  const containerRef = useRef<HTMLDivElement>(null);

  if (collections.length === 0) return null;

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="qzk-lib-group" ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <span className="qzk-lib-title" style={{ flex: 1, padding: "4px 6px" }}>
          Collections
        </span>
        <button
          className="qz-btn qz-ghost qz-sm"
          title="New Collection…"
          onClick={() => {
            void askParams("New Collection", [
              { key: "name", label: "Name", type: "text", default: "" },
              { key: "query", label: "Query", type: "text", default: "", hint: QUERY_HINT },
            ]).then((p) => {
              if (p && String(p.name).trim()) addCollection(String(p.name), String(p.query));
            });
          }}
        >
          ＋
        </button>
      </div>
      {collections.map((c) => {
        const members = collectionMembers(hierarchy, c);
        const open = openIds.has(c.id);
        return (
          <div key={c.id}>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <button
                className="qzk-group-head"
                style={{ flex: 1, minWidth: 0 }}
                title={c.query ? `query: ${c.query}` : "empty query — matches everything"}
                onClick={() => toggle(c.id)}
              >
                <span className="qzk-group-caret">{open ? "▾" : "▸"}</span>
                <span className="qzk-group-name">⊙ {c.name}</span>
                <span className="qzk-group-count">{members.length}</span>
              </button>
              <button
                className="qz-btn qz-ghost qz-sm"
                title="Rename Collection…"
                onClick={() => {
                  void askParams("Rename Collection", [{ key: "name", label: "Name", type: "text", default: c.name }])
                    .then((p) => { if (p && String(p.name).trim()) renameCollection(c.id, String(p.name)); });
                }}
              >
                ✎
              </button>
              <button
                className="qz-btn qz-ghost qz-sm"
                title="Edit Collection filter…"
                onClick={() => {
                  void askParams("Edit Collection filter", [
                    { key: "query", label: "Query", type: "text", default: c.query, hint: QUERY_HINT },
                  ]).then((p) => { if (p) updateCollectionQuery(c.id, String(p.query)); });
                }}
              >
                ⚙
              </button>
              <button
                className="qz-btn qz-ghost qz-sm"
                title="Delete Collection (its members are untouched — L0.48)"
                onClick={() => removeRowSafely(containerRef.current, () => removeCollection(c.id))}
              >
                ×
              </button>
            </div>
            {open &&
              members.map((node) => (
                <button
                  key={node.key}
                  type="button"
                  className="qzk-collection-member"
                  title={`Show in Library — ${node.name}`}
                  onClick={() => onShowInLibrary(node)}
                >
                  <span aria-hidden="true">{KIND_GLYPH[node.kind]}</span>
                  <span>{node.name}</span>
                </button>
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
